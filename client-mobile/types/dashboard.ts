import { CarpoolTripRecord, TripRecord } from '@/types/trips';

export type TreeUnlockMetric = 'points' | 'co2SavedKg';

export type ForestTree = {
  id: number;
  userId: number;
  treeTypeId: string;
  gridX: number;
  gridY: number;
  pointsCost: number;
  plantedAt: string;
};

export type TreeCatalogEntry = {
  id: string;
  name: string;
  tier: string;
  cost: number;
  description: string;
  unlockMetric: TreeUnlockMetric;
  unlockValue: number;
  unlockRequirement: string;
  unlockProgress: number;
  isUnlocked: boolean;
  isAffordable: boolean;
  plantedCount: number;
};

export type DashboardSummary = {
  userId: number;
  displayName: string;
  totalPointsEarned: number;
  totalPointsSpent: number;
  totalPointsAvailable: number;
  totalTrips: number;
  totalDistanceMeters: number;
  totalCo2Kg: number;
  totalCo2SavedKg: number;
  totalTrees: number;
  carpoolCancellationCount: number;
  carpoolBlocked: boolean;
};

export type ForestAchievement = {
  id: string;
  title: string;
  description: string;
  currentValue: number;
  targetValue: number;
  unit: string;
  earned: boolean;
  progress: number;
};

export type RecentTrip = {
  id: number;
  userId: number;
  displayName: string;
  routeType: TripRecord['routeType'];
  routeTitle: string;
  originLabel: string;
  destinationLabel: string;
  distanceMeters: number;
  durationSeconds: number;
  co2Kg: number;
  co2SavedKg: number;
  participantRole: TripRecord['participantRole'];
  completedAt: string;
  createdAt: string;
};

export type CarpoolDashboardSummary = {
  totalCarpoolTrips: number;
  activeTrips: number;
  pastTrips: number;
  completedTrips: number;
  driverTrips: number;
  riderTrips: number;
  totalRidersHelped: number;
  totalSharedCo2SavedKg: number;
  highestImpactMultiplier: number;
  pendingApprovals: number;
  outgoingPendingRequests: number;
  cancellationCount: number;
  isBlocked: boolean;
};

export type UserDashboard = {
  summary: DashboardSummary;
  forest: {
    gridColumns: number;
    gridRows: number;
    plantedTrees: ForestTree[];
    totalTrees: number;
    treeCatalog: TreeCatalogEntry[];
  };
  achievements: ForestAchievement[];
  narrative: string;
  recentTrips: RecentTrip[];
  carpools: {
    summary: CarpoolDashboardSummary;
    trips: CarpoolTripRecord[];
  };
};

export type PlantTreePayload = {
  userId: number;
  treeTypeId: string;
  gridX: number;
  gridY: number;
};
