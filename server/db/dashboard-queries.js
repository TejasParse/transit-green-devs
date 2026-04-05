const { listMyCarpools } = require('./carpool-queries');
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
    participantRole: row.participant_role ?? null,
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
        profiles.carpool_cancellation_count::INTEGER AS carpool_cancellation_count,
        profiles.carpool_blocked,
        COALESCE(trip_stats.total_trips, 0)::INTEGER AS total_trips,
        COALESCE(trip_stats.total_distance_meters, 0)::INTEGER AS total_distance_meters,
        COALESCE(trip_stats.total_co2_kg, 0)::FLOAT8 AS total_co2_kg,
        COALESCE(trip_stats.total_co2_saved_kg, 0)::FLOAT8 AS total_co2_saved_kg,
        COALESCE(forest_stats.total_trees, 0)::INTEGER AS total_trees,
        COALESCE(forest_stats.total_points_spent, 0)::INTEGER AS total_points_spent
      FROM profiles
      LEFT JOIN (
        SELECT
          trip_users.user_id,
          COUNT(*) FILTER (
            WHERE trips.status IN ('completed', 'ended')
              AND trip_users.left_at IS NULL
          )::INTEGER AS total_trips,
          COALESCE(SUM(CASE
            WHEN trips.status IN ('completed', 'ended')
              AND trip_users.left_at IS NULL
            THEN trips.distance_meters
            ELSE 0
          END), 0)::INTEGER AS total_distance_meters,
          COALESCE(SUM(CASE
            WHEN trips.status IN ('completed', 'ended')
              AND trip_users.left_at IS NULL
              AND trips.route_type = 'carpool'
              AND participant_counts.participant_count > 0
            THEN trips.co2_kg / participant_counts.participant_count
            WHEN trips.status IN ('completed', 'ended')
              AND trip_users.left_at IS NULL
            THEN trips.co2_kg
            ELSE 0
          END), 0)::FLOAT8 AS total_co2_kg,
          COALESCE(SUM(CASE
            WHEN trips.status IN ('completed', 'ended')
              AND trip_users.left_at IS NULL
              AND trips.route_type = 'carpool'
              AND participant_counts.participant_count > 0
            THEN trips.co2_saved_kg / participant_counts.participant_count
            WHEN trips.status IN ('completed', 'ended')
              AND trip_users.left_at IS NULL
            THEN trips.co2_saved_kg
            ELSE 0
          END), 0)::FLOAT8 AS total_co2_saved_kg
        FROM trip_users
        INNER JOIN trips ON trips.id = trip_users.trip_id
        LEFT JOIN (
          SELECT
            trip_id,
            COUNT(*) FILTER (WHERE left_at IS NULL)::INTEGER AS participant_count
          FROM trip_users
          GROUP BY trip_id
        ) AS participant_counts ON participant_counts.trip_id = trips.id
        GROUP BY trip_users.user_id
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
    carpoolCancellationCount: row.carpool_cancellation_count,
    carpoolBlocked: row.carpool_blocked,
  };
}

async function getRecentTrips(userId, db = pool, limit = 4) {
  const result = await db.query(
    `
      SELECT *
      FROM (
        SELECT DISTINCT ON (trips.id)
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
          trip_users.participant_role,
          profiles.user_name AS display_name
        FROM trips
        INNER JOIN profiles ON profiles.id = trips.user_id
        LEFT JOIN trip_users
          ON trip_users.trip_id = trips.id
         AND trip_users.user_id = $1
        WHERE trips.status IN ('completed', 'ended')
          AND (
            trips.user_id = $1
            OR trip_users.user_id = $1
          )
        ORDER BY trips.id, trip_users.joined_at DESC NULLS LAST
      ) AS recent_trips
      ORDER BY completed_at DESC, id DESC
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

function buildCarpoolSummary(carpools, summary) {
  const activeTrips = carpools.filter((trip) =>
    ['draft', 'scheduled', 'confirmed', 'active'].includes(trip.status)
  );
  const pastTrips = carpools.filter((trip) =>
    ['completed', 'ended', 'cancelled', 'expired'].includes(trip.status)
  );
  const completedTrips = carpools.filter((trip) => ['completed', 'ended'].includes(trip.status));
  const driverTrips = carpools.filter((trip) => trip.currentUserRole === 'driver');
  const riderTrips = carpools.filter((trip) => trip.currentUserRole === 'rider');
  const pendingApprovals = driverTrips.reduce(
    (total, trip) => total + trip.requests.filter((request) => request.status === 'pending').length,
    0
  );
  const outgoingPendingRequests = riderTrips.filter(
    (trip) => trip.currentUserRequest?.status === 'pending'
  ).length;
  const totalRidersHelped = completedTrips.reduce((total, trip) => {
    if (trip.currentUserRole !== 'driver') {
      return total;
    }

    return total + trip.participants.filter((participant) => participant.role === 'rider').length;
  }, 0);
  const totalSharedCo2SavedKg = completedTrips.reduce((total, trip) => total + trip.co2SavedKg, 0);
  const highestImpactMultiplier = completedTrips.reduce(
    (best, trip) => Math.max(best, trip.carpoolImpactMultiplier ?? 1),
    1
  );

  return {
    totalCarpoolTrips: carpools.length,
    activeTrips: activeTrips.length,
    pastTrips: pastTrips.length,
    completedTrips: completedTrips.length,
    driverTrips: driverTrips.length,
    riderTrips: riderTrips.length,
    totalRidersHelped,
    totalSharedCo2SavedKg: Number(totalSharedCo2SavedKg.toFixed(3)),
    highestImpactMultiplier,
    pendingApprovals,
    outgoingPendingRequests,
    cancellationCount: summary.carpoolCancellationCount,
    isBlocked: summary.carpoolBlocked,
  };
}

function buildAchievements(summary, carpoolSummary) {
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
      id: 'ten-kg-saved',
      title: '10 kg CO2 Saved',
      description: 'Avoid 10 kilograms of CO2 through lower-carbon travel.',
      currentValue: Math.min(summary.totalCo2SavedKg, 10),
      targetValue: 10,
      unit: 'kg CO2',
    },
    {
      id: 'first-carpool-ride',
      title: 'First Carpool Ride',
      description: 'Complete your first carpool trip as a driver or rider.',
      currentValue: Math.min(carpoolSummary.completedTrips, 1),
      targetValue: 1,
      unit: 'rides',
    },
    {
      id: 'shared-five-rides',
      title: 'Shared 5 Rides',
      description: 'Take part in five completed carpools.',
      currentValue: Math.min(carpoolSummary.completedTrips, 5),
      targetValue: 5,
      unit: 'rides',
    },
    {
      id: 'eco-driver',
      title: 'Eco Driver',
      description: 'Help five riders reach their destination in shared carpools.',
      currentValue: Math.min(carpoolSummary.totalRidersHelped, 5),
      targetValue: 5,
      unit: 'riders',
    },
  ];

  return achievements.map((achievement) => ({
    ...achievement,
    earned: achievement.currentValue >= achievement.targetValue,
    progress: achievement.targetValue > 0 ? achievement.currentValue / achievement.targetValue : 1,
  }));
}

function buildNarrative(summary, carpoolSummary) {
  if (carpoolSummary.completedTrips > 0) {
    return `Your forest reflects ${summary.totalCo2SavedKg.toFixed(
      2
    )} kg of avoided CO2, including ${carpoolSummary.totalSharedCo2SavedKg.toFixed(
      2
    )} kg saved through carpools with up to ${carpoolSummary.highestImpactMultiplier.toFixed(
      1
    )}x shared impact.`;
  }

  if (summary.totalTrees === 0) {
    return 'Each tree you plant turns your transit choices into a visible record of climate-positive impact.';
  }

  return `Your forest represents ${summary.totalCo2SavedKg.toFixed(2)} kg of avoided CO2 and ${summary.totalTrees} planted tree${summary.totalTrees === 1 ? '' : 's'} from your sustainable trips.`;
}

async function getUserDashboard(userId) {
  const [summary, plantedTrees, recentTrips, myCarpools] = await Promise.all([
    getProfileSummary(userId),
    getForestTrees(userId),
    getRecentTrips(userId),
    listMyCarpools(userId),
  ]);

  const treeCatalog = buildTreeCatalog(summary, plantedTrees);
  const carpoolSummary = buildCarpoolSummary(myCarpools, summary);

  return {
    summary,
    forest: {
      gridColumns: TREE_GRID_COLUMNS,
      gridRows: TREE_GRID_ROWS,
      plantedTrees,
      totalTrees: plantedTrees.length,
      treeCatalog,
    },
    achievements: buildAchievements(summary, carpoolSummary),
    narrative: buildNarrative(summary, carpoolSummary),
    recentTrips,
    carpools: {
      summary: carpoolSummary,
      trips: myCarpools,
    },
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
          AND status IN ('completed', 'ended')
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
