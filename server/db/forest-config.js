const TREE_GRID_COLUMNS = 4;
const TREE_GRID_ROWS = 4;

const TREE_TYPES = [
  {
    id: 'sapling',
    name: 'Sapling',
    tier: 'Starter',
    cost: 20,
    unlockMetric: 'points',
    unlockValue: 0,
    description: 'A first spark of climate-friendly momentum.',
  },
  {
    id: 'bush',
    name: 'Bush',
    tier: 'Starter',
    cost: 45,
    unlockMetric: 'points',
    unlockValue: 60,
    description: 'A fuller patch of impact from everyday low-carbon choices.',
  },
  {
    id: 'oak',
    name: 'Oak',
    tier: 'Canopy',
    cost: 90,
    unlockMetric: 'points',
    unlockValue: 150,
    description: 'A long-term tree for riders building consistent habits.',
  },
  {
    id: 'pine',
    name: 'Pine',
    tier: 'Canopy',
    cost: 130,
    unlockMetric: 'co2SavedKg',
    unlockValue: 4,
    description: 'A resilient evergreen unlocked through meaningful emissions savings.',
  },
  {
    id: 'cherry-blossom',
    name: 'Cherry Blossom',
    tier: 'Showcase',
    cost: 210,
    unlockMetric: 'points',
    unlockValue: 300,
    description: 'A signature tree for standout sustainability progress.',
  },
  {
    id: 'cedar',
    name: 'Cedar',
    tier: 'Legacy',
    cost: 320,
    unlockMetric: 'co2SavedKg',
    unlockValue: 8,
    description: 'A legacy tree for riders making a lasting climate impact.',
  },
];

function formatUnlockRequirement(treeType) {
  if (treeType.unlockMetric === 'co2SavedKg') {
    return `Unlock at ${treeType.unlockValue} kg CO2 saved`;
  }

  return `Unlock at ${treeType.unlockValue} points`;
}

function getUnlockProgress(summary, treeType) {
  const currentValue =
    treeType.unlockMetric === 'co2SavedKg' ? summary.totalCo2SavedKg : summary.totalPointsEarned;
  const targetValue = treeType.unlockValue;

  if (targetValue <= 0) {
    return 1;
  }

  return Math.max(Math.min(currentValue / targetValue, 1), 0);
}

function isTreeUnlockedForSummary(summary, treeType) {
  const currentValue =
    treeType.unlockMetric === 'co2SavedKg' ? summary.totalCo2SavedKg : summary.totalPointsEarned;

  return currentValue >= treeType.unlockValue;
}

function getTreeTypeById(treeTypeId) {
  return TREE_TYPES.find((treeType) => treeType.id === treeTypeId) ?? null;
}

module.exports = {
  formatUnlockRequirement,
  getTreeTypeById,
  getUnlockProgress,
  isTreeUnlockedForSummary,
  TREE_GRID_COLUMNS,
  TREE_GRID_ROWS,
  TREE_TYPES,
};
