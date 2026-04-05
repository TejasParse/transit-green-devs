const { pool } = require('./pool');
const {
  formatUnlockRequirement,
  getTreeTypeById,
  getUnlockProgress,
  isTreeUnlockedForSummary,
  TREE_GRID_COLUMNS,
  TREE_GRID_ROWS,
  TREE_TYPES,
} = require('./forest-config');

function mapRecentTripPreviewRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    routeType: row.route_type,
    routeTitle: row.route_title,
    originLabel: row.origin_label,
    destinationLabel: row.destination_label,
    distanceMeters: row.distance_meters,
    durationSeconds: row.duration_seconds,
    co2Kg: Number(row.co2_kg),
    co2SavedKg: Number(row.co2_saved_kg),
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

function mapForestTreeRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    treeTypeId: row.tree_type,
    gridX: row.grid_x,
    gridY: row.grid_y,
    pointsCost: row.points_cost,
    plantedAt: row.created_at,
  };
}

async function getProfileSummary(userId, db = pool) {
  const result = await db.query(
    `
      SELECT
        profiles.id AS user_id,
        profiles.user_name AS display_name,
        profiles.total_points::INTEGER AS total_points_earned,
        COALESCE(trip_stats.total_trips, 0)::INTEGER AS total_trips,
        COALESCE(trip_stats.total_distance_meters, 0)::INTEGER AS total_distance_meters,
        COALESCE(trip_stats.total_co2_kg, 0)::FLOAT8 AS total_co2_kg,
        COALESCE(trip_stats.total_co2_saved_kg, 0)::FLOAT8 AS total_co2_saved_kg,
        COALESCE(forest_stats.total_trees, 0)::INTEGER AS total_trees,
        COALESCE(forest_stats.total_points_spent, 0)::INTEGER AS total_points_spent
      FROM profiles
      LEFT JOIN (
        SELECT
          user_id,
          COUNT(*)::INTEGER AS total_trips,
          COALESCE(SUM(distance_meters), 0)::INTEGER AS total_distance_meters,
          COALESCE(SUM(co2_kg), 0)::FLOAT8 AS total_co2_kg,
          COALESCE(SUM(co2_saved_kg), 0)::FLOAT8 AS total_co2_saved_kg
        FROM trips
        WHERE status = 'ended'
        GROUP BY user_id
      ) AS trip_stats ON trip_stats.user_id = profiles.id
      LEFT JOIN (
        SELECT
          user_id,
          COUNT(*)::INTEGER AS total_trees,
          COALESCE(SUM(points_cost), 0)::INTEGER AS total_points_spent
        FROM forest_trees
        GROUP BY user_id
      ) AS forest_stats ON forest_stats.user_id = profiles.id
      WHERE profiles.id = $1
    `,
    [userId]
  );

  if (result.rowCount === 0) {
    throw new Error(`Profile ${userId} does not exist.`);
  }

  const row = result.rows[0];
  const totalPointsEarned = row.total_points_earned;
  const totalPointsSpent = row.total_points_spent;

  return {
    userId: row.user_id,
    displayName: row.display_name,
    totalPointsEarned,
    totalPointsSpent,
    totalPointsAvailable: Math.max(totalPointsEarned - totalPointsSpent, 0),
    totalTrips: row.total_trips,
    totalDistanceMeters: row.total_distance_meters,
    totalCo2Kg: Number(row.total_co2_kg),
    totalCo2SavedKg: Number(row.total_co2_saved_kg),
    totalTrees: row.total_trees,
  };
}

async function getRecentTrips(userId, db = pool, limit = 4) {
  const result = await db.query(
    `
      SELECT
        trips.id,
        trips.user_id,
        trips.route_type,
        trips.route_title,
        trips.origin_label,
        trips.destination_label,
        trips.distance_meters,
        trips.duration_seconds,
        trips.co2_kg,
        trips.co2_saved_kg,
        trips.completed_at,
        trips.created_at,
        profiles.user_name AS display_name
      FROM trips
      INNER JOIN profiles ON profiles.id = trips.user_id
      WHERE trips.user_id = $1
        AND trips.status = 'ended'
      ORDER BY trips.completed_at DESC, trips.id DESC
      LIMIT $2
    `,
    [userId, limit]
  );

  return result.rows.map(mapRecentTripPreviewRow);
}

async function getForestTrees(userId, db = pool) {
  const result = await db.query(
    `
      SELECT
        id,
        user_id,
        tree_type,
        grid_x,
        grid_y,
        points_cost,
        created_at
      FROM forest_trees
      WHERE user_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [userId]
  );

  return result.rows.map(mapForestTreeRow);
}

function buildTreeCatalog(summary, plantedTrees) {
  const plantedCounts = plantedTrees.reduce((counts, tree) => {
    counts.set(tree.treeTypeId, (counts.get(tree.treeTypeId) ?? 0) + 1);
    return counts;
  }, new Map());

  return TREE_TYPES.map((treeType) => {
    const isUnlocked = isTreeUnlockedForSummary(summary, treeType);
    const unlockProgress = getUnlockProgress(summary, treeType);

    return {
      id: treeType.id,
      name: treeType.name,
      tier: treeType.tier,
      cost: treeType.cost,
      description: treeType.description,
      unlockMetric: treeType.unlockMetric,
      unlockValue: treeType.unlockValue,
      unlockRequirement: formatUnlockRequirement(treeType),
      unlockProgress,
      isUnlocked,
      isAffordable: summary.totalPointsAvailable >= treeType.cost,
      plantedCount: plantedCounts.get(treeType.id) ?? 0,
    };
  });
}

function buildAchievements(summary) {
  const achievements = [
    {
      id: 'first-tree',
      title: 'First Tree Planted',
      description: 'Plant your first tree in the virtual forest.',
      currentValue: Math.min(summary.totalTrees, 1),
      targetValue: 1,
      unit: 'trees',
    },
    {
      id: 'five-trees',
      title: '5 Trees Planted',
      description: 'Grow your forest to five planted trees.',
      currentValue: Math.min(summary.totalTrees, 5),
      targetValue: 5,
      unit: 'trees',
    },
    {
      id: 'ten-trees',
      title: '10 Trees Planted',
      description: 'Turn your forest into a thriving canopy.',
      currentValue: Math.min(summary.totalTrees, 10),
      targetValue: 10,
      unit: 'trees',
    },
    {
      id: 'ten-kg-saved',
      title: '10 kg CO2 Saved',
      description: 'Avoid 10 kilograms of CO2 through lower-carbon travel.',
      currentValue: Math.min(summary.totalCo2SavedKg, 10),
      targetValue: 10,
      unit: 'kg CO2',
    },
  ];

  return achievements.map((achievement) => ({
    ...achievement,
    earned: achievement.currentValue >= achievement.targetValue,
    progress: achievement.targetValue > 0 ? achievement.currentValue / achievement.targetValue : 1,
  }));
}

function buildNarrative(summary) {
  if (summary.totalTrees === 0) {
    return 'Each tree you plant turns your transit choices into a visible record of climate-positive impact.';
  }

  return `Your forest represents ${summary.totalCo2SavedKg.toFixed(2)} kg of avoided CO2 and ${summary.totalTrees} planted tree${summary.totalTrees === 1 ? '' : 's'} from your sustainable trips.`;
}

async function getUserDashboard(userId) {
  const [summary, plantedTrees, recentTrips] = await Promise.all([
    getProfileSummary(userId),
    getForestTrees(userId),
    getRecentTrips(userId),
  ]);

  const treeCatalog = buildTreeCatalog(summary, plantedTrees);

  return {
    summary,
    forest: {
      gridColumns: TREE_GRID_COLUMNS,
      gridRows: TREE_GRID_ROWS,
      plantedTrees,
      totalTrees: plantedTrees.length,
      treeCatalog,
    },
    achievements: buildAchievements(summary),
    narrative: buildNarrative(summary),
    recentTrips,
  };
}

async function plantForestTree({ userId, treeTypeId, gridX, gridY }) {
  const treeType = getTreeTypeById(treeTypeId);

  if (!treeType) {
    throw new Error(`Unknown tree type "${treeTypeId}".`);
  }

  if (gridX < 0 || gridX >= TREE_GRID_COLUMNS || gridY < 0 || gridY >= TREE_GRID_ROWS) {
    throw new Error(`Choose a forest tile inside the ${TREE_GRID_COLUMNS}x${TREE_GRID_ROWS} grid.`);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const profileResult = await client.query(
      `
        SELECT id, total_points::INTEGER AS total_points_earned
        FROM profiles
        WHERE id = $1
        FOR UPDATE
      `,
      [userId]
    );

    if (profileResult.rowCount === 0) {
      throw new Error(`Profile ${userId} does not exist.`);
    }

    const tripStatsResult = await client.query(
      `
        SELECT
          COUNT(*)::INTEGER AS total_trips,
          COALESCE(SUM(distance_meters), 0)::INTEGER AS total_distance_meters,
          COALESCE(SUM(co2_kg), 0)::FLOAT8 AS total_co2_kg,
          COALESCE(SUM(co2_saved_kg), 0)::FLOAT8 AS total_co2_saved_kg
        FROM trips
        WHERE user_id = $1
          AND status = 'ended'
      `,
      [userId]
    );

    const forestStatsResult = await client.query(
      `
        SELECT
          COUNT(*)::INTEGER AS total_trees,
          COALESCE(SUM(points_cost), 0)::INTEGER AS total_points_spent
        FROM forest_trees
        WHERE user_id = $1
      `,
      [userId]
    );

    const summary = {
      userId,
      totalPointsEarned: profileResult.rows[0].total_points_earned,
      totalPointsSpent: forestStatsResult.rows[0].total_points_spent,
      totalPointsAvailable:
        profileResult.rows[0].total_points_earned - forestStatsResult.rows[0].total_points_spent,
      totalTrips: tripStatsResult.rows[0].total_trips,
      totalDistanceMeters: tripStatsResult.rows[0].total_distance_meters,
      totalCo2Kg: Number(tripStatsResult.rows[0].total_co2_kg),
      totalCo2SavedKg: Number(tripStatsResult.rows[0].total_co2_saved_kg),
      totalTrees: forestStatsResult.rows[0].total_trees,
    };

    if (!isTreeUnlockedForSummary(summary, treeType)) {
      throw new Error(`${treeType.name} is still locked. ${formatUnlockRequirement(treeType)}.`);
    }

    if (summary.totalPointsAvailable < treeType.cost) {
      throw new Error(`You need ${treeType.cost} points to plant a ${treeType.name}.`);
    }

    const occupiedCellResult = await client.query(
      `
        SELECT 1
        FROM forest_trees
        WHERE user_id = $1
          AND grid_x = $2
          AND grid_y = $3
      `,
      [userId, gridX, gridY]
    );

    if (occupiedCellResult.rowCount > 0) {
      throw new Error('That forest tile already has a planted tree.');
    }

    await client.query(
      `
        INSERT INTO forest_trees (
          user_id,
          tree_type,
          grid_x,
          grid_y,
          points_cost
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [userId, treeType.id, gridX, gridY, treeType.cost]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return getUserDashboard(userId);
}

module.exports = {
  getUserDashboard,
  plantForestTree,
};
