export type EcoDestinationCategory =
  | 'sustainable_ev_hubs'
  | 'reuse_donation_center'
  | 'recycling_specialized_waste_dropoff';

export type EcoDestination = {
  id: number;
  name: string;
  category: EcoDestinationCategory;
  address: string;
  features: string[];
  coordinates: {
    latitude: number;
    longitude: number;
  };
};
