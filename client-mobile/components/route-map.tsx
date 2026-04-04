import { Platform } from 'react-native';

import type { Coordinate } from '@/types/app';

type RouteMapProps = {
  origin: Coordinate;
  destination?: Coordinate | null;
  routePath?: Coordinate[];
  currentPosition?: Coordinate | null;
  onOriginSelect?: (coordinate: Coordinate) => void;
  isTripActive?: boolean;
};

const RouteMapImpl =
  Platform.OS === 'web'
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./route-map.web').RouteMap
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./route-map.native').RouteMap;

export function RouteMap(props: RouteMapProps) {
  return <RouteMapImpl {...props} />;
}
