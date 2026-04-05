const fs = require('node:fs');
const path = require('node:path');

const { pool } = require('./pool');
const { ensureSchema, resetSchema } = require('./schema');
const { createTripRecord } = require('./trip-queries');

const now = Date.now();
const CARS_CSV_PATH = path.join(__dirname, '..', '..', 'co2.csv');

const demoProfiles = [
  {
    key: 'campus-rider',
    userName: 'Campus Rider',
    carId: 1,
    totalPoints: 0,
    email: 'campus.rider@example.com',
    age: 22,
    gender: 'female',
    licenceNo: 'A94276153',
  },
  {
    key: 'bike-commuter',
    userName: 'Bike Commuter',
    carId: null,
    totalPoints: 0,
    email: 'bike.commuter@example.com',
    age: 28,
    gender: 'male',
    licenceNo: null,
  },
  {
    key: 'transit-fan',
    userName: 'Transit Fan',
    carId: null,
    totalPoints: 0,
    email: 'transit.fan@example.com',
    age: 25,
    gender: 'female',
    licenceNo: null,
  },
  {
    key: 'community-driver',
    userName: 'Community Driver',
    carId: 4,
    totalPoints: 0,
    email: 'community.driver@example.com',
    age: 31,
    gender: 'non-binary',
    licenceNo: '615208473',
  },
];

const demoTrips = [
  {
    key: 'walk-ended',
    profileKey: 'campus-rider',
    displayName: 'Campus Rider',
    routeType: 'walk',
    routeTitle: 'Walk route',
    originLabel: 'Tempe Campus Library',
    destinationLabel: 'Mill Avenue District',
    distanceMeters: 1800,
    durationSeconds: 1320,
    co2Kg: 0,
    co2SavedKg: 0.241,
    availableSeats: 0,
    status: 'ended',
    startedAt: new Date(now - 1000 * 60 * 240).toISOString(),
    completedAt: new Date(now - 1000 * 60 * 218).toISOString(),
    pathPoints: [
      { latitude: 33.4206, longitude: -111.9344 },
      { latitude: 33.4222, longitude: -111.9314 },
      { latitude: 33.4249, longitude: -111.9281 },
    ],
    metadata: {
      badges: ['0 kg CO2', 'Lowest carbon'],
      summary: 'Seeded walking trip for local development.',
    },
  },
  {
    key: 'bike-ended',
    profileKey: 'bike-commuter',
    displayName: 'Bike Commuter',
    routeType: 'bike',
    routeTitle: 'Bike route',
    originLabel: 'Apache Boulevard',
    destinationLabel: 'Downtown Tempe',
    distanceMeters: 3200,
    durationSeconds: 1080,
    co2Kg: 0,
    co2SavedKg: 0.414,
    availableSeats: 0,
    status: 'ended',
    startedAt: new Date(now - 1000 * 60 * 205).toISOString(),
    completedAt: new Date(now - 1000 * 60 * 187).toISOString(),
    pathPoints: [
      { latitude: 33.4148, longitude: -111.9091 },
      { latitude: 33.4187, longitude: -111.9215 },
      { latitude: 33.4252, longitude: -111.9392 },
    ],
    metadata: {
      badges: ['Near-zero CO2', 'Active travel'],
      summary: 'Seeded cycling trip for local development.',
    },
  },
  {
    key: 'drive-ended',
    profileKey: 'campus-rider',
    displayName: 'Campus Rider',
    routeType: 'drive',
    routeTitle: 'Fuel-efficient drive',
    originLabel: 'Phoenix Sky Harbor',
    destinationLabel: 'ASU Tempe Campus',
    distanceMeters: 12200,
    durationSeconds: 1260,
    co2Kg: 1.021,
    co2SavedKg: 0.148,
    availableSeats: 1,
    status: 'ended',
    startedAt: new Date(now - 1000 * 60 * 150).toISOString(),
    completedAt: new Date(now - 1000 * 60 * 129).toISOString(),
    pathPoints: [
      { latitude: 33.4351, longitude: -112.0078 },
      { latitude: 33.4318, longitude: -111.9745 },
      { latitude: 33.4234, longitude: -111.94 },
    ],
    metadata: {
      badges: ['Fuel-efficient', 'Car navigation'],
      summary: 'Seeded completed driving trip for local development.',
    },
  },
  {
    key: 'transit-active',
    profileKey: 'transit-fan',
    displayName: 'Transit Fan',
    routeType: 'transit',
    routeTitle: 'Public transit',
    originLabel: 'Mesa Arts Center',
    destinationLabel: 'ASU Tempe Campus',
    distanceMeters: 7600,
    durationSeconds: 2100,
    co2Kg: 0.38,
    co2SavedKg: 0.679,
    availableSeats: 0,
    status: 'active',
    startedAt: new Date(now - 1000 * 60 * 35).toISOString(),
    completedAt: new Date(now + 1000 * 60 * 5).toISOString(),
    pathPoints: [
      { latitude: 33.4155, longitude: -111.8315 },
      { latitude: 33.4157, longitude: -111.8995 },
      { latitude: 33.4234, longitude: -111.94 },
    ],
    metadata: {
      badges: ['Shared ride', 'Low carbon'],
      summary: 'Seeded active transit trip for local development.',
    },
  },
  {
    key: 'drive-scheduled',
    profileKey: 'campus-rider',
    displayName: 'Campus Rider',
    routeType: 'drive',
    routeTitle: 'Fuel-efficient drive',
    originLabel: 'ASU Tempe Campus',
    destinationLabel: 'Scottsdale Waterfront',
    distanceMeters: 15100,
    durationSeconds: 1440,
    co2Kg: 1.184,
    co2SavedKg: 0.163,
    availableSeats: 2,
    status: 'scheduled',
    startedAt: new Date(now + 1000 * 60 * 60).toISOString(),
    completedAt: new Date(now + 1000 * 60 * 84).toISOString(),
    pathPoints: [
      { latitude: 33.4234, longitude: -111.94 },
      { latitude: 33.4573, longitude: -111.9261 },
      { latitude: 33.5018, longitude: -111.9251 },
    ],
    metadata: {
      badges: ['Fuel-efficient', 'Car navigation'],
      summary: 'Seeded scheduled driving trip for local development.',
    },
  },
  {
    key: 'drive-cancelled',
    profileKey: 'community-driver',
    displayName: 'Community Driver',
    routeType: 'drive',
    routeTitle: 'Fuel-efficient drive',
    originLabel: 'Downtown Phoenix',
    destinationLabel: 'Tempe Marketplace',
    distanceMeters: 13800,
    durationSeconds: 1320,
    co2Kg: 1.097,
    co2SavedKg: 0.152,
    availableSeats: 3,
    status: 'cancelled',
    startedAt: new Date(now - 1000 * 60 * 90).toISOString(),
    completedAt: new Date(now - 1000 * 60 * 68).toISOString(),
    pathPoints: [
      { latitude: 33.4484, longitude: -112.074 },
      { latitude: 33.4382, longitude: -112.0126 },
      { latitude: 33.4301, longitude: -111.9012 },
    ],
    metadata: {
      badges: ['Fuel-efficient', 'Car navigation'],
      summary: 'Seeded cancelled driving trip for local development.',
    },
  },
];

const demoTripUsers = [
  { tripKey: 'walk-ended', driverKey: 'campus-rider', riderKey: 'campus-rider' },
  { tripKey: 'bike-ended', driverKey: 'bike-commuter', riderKey: 'bike-commuter' },
  { tripKey: 'drive-ended', driverKey: 'campus-rider', riderKey: 'campus-rider' },
  { tripKey: 'drive-ended', driverKey: 'campus-rider', riderKey: 'bike-commuter' },
  { tripKey: 'transit-active', driverKey: 'transit-fan', riderKey: 'transit-fan' },
  { tripKey: 'drive-scheduled', driverKey: 'campus-rider', riderKey: 'campus-rider' },
  { tripKey: 'drive-scheduled', driverKey: 'campus-rider', riderKey: 'transit-fan' },
  { tripKey: 'drive-scheduled', driverKey: 'campus-rider', riderKey: 'community-driver' },
  { tripKey: 'drive-cancelled', driverKey: 'community-driver', riderKey: 'community-driver' },
  { tripKey: 'drive-cancelled', driverKey: 'community-driver', riderKey: 'bike-commuter' },
];

const ecoDestinations = [
  { name: 'Roosevelt Row EV Hub', category: 'sustainable_ev_hubs', address: '918 N 2nd St, Phoenix, AZ 85004', features: ['DC fast charging', 'Solar shade canopy', '24/7 access'], latitude: 33.45892, longitude: -112.07173 },
  { name: 'Tempe Town Lake Charge Point', category: 'sustainable_ev_hubs', address: '80 W Rio Salado Pkwy, Tempe, AZ 85281', features: ['Level 2 charging', 'Lakefront parking', 'Nearby cafes'], latitude: 33.43176, longitude: -111.93955 },
  { name: 'Scottsdale Civic Center EV Plaza', category: 'sustainable_ev_hubs', address: '3939 N Drinkwater Blvd, Scottsdale, AZ 85251', features: ['Fast chargers', 'Covered stalls', 'Walkable downtown access'], latitude: 33.4944, longitude: -111.92646 },
  { name: 'Downtown Mesa EV Commons', category: 'sustainable_ev_hubs', address: '56 E Main St, Mesa, AZ 85201', features: ['Rapid charging', 'Retail corridor', 'Night lighting'], latitude: 33.41502, longitude: -111.83058 },
  { name: 'Arcadia Clean Charge Yard', category: 'sustainable_ev_hubs', address: '4202 E Indian School Rd, Phoenix, AZ 85018', features: ['Level 3 chargers', 'Shade trees', 'Coffee stop'], latitude: 33.49495, longitude: -111.99218 },
  { name: 'Biltmore EV Terrace', category: 'sustainable_ev_hubs', address: '2402 E Camelback Rd, Phoenix, AZ 85016', features: ['Covered stalls', 'Fast charging', 'Shopping access'], latitude: 33.50918, longitude: -112.03072 },
  { name: 'North Phoenix Solar Charge Hub', category: 'sustainable_ev_hubs', address: '2450 W Happy Valley Rd, Phoenix, AZ 85085', features: ['Solar canopy', 'Restrooms nearby', 'Fast chargers'], latitude: 33.71168, longitude: -112.11204 },
  { name: 'Deer Valley EV Exchange', category: 'sustainable_ev_hubs', address: '2902 W Agua Fria Fwy, Phoenix, AZ 85027', features: ['Highway access', 'Food nearby', 'Level 2 charging'], latitude: 33.64456, longitude: -112.12236 },
  { name: 'Westgate EV Station Row', category: 'sustainable_ev_hubs', address: '6751 N Sunset Blvd, Glendale, AZ 85305', features: ['Entertainment district', 'Fast chargers', 'Late hours'], latitude: 33.53131, longitude: -112.26139 },
  { name: 'Peoria Green Plug Plaza', category: 'sustainable_ev_hubs', address: '16101 N 83rd Ave, Peoria, AZ 85382', features: ['Community charging', 'Covered parking', 'Bike racks'], latitude: 33.63218, longitude: -112.2361 },
  { name: 'Surprise Energy Stop', category: 'sustainable_ev_hubs', address: '16089 N Bullard Ave, Surprise, AZ 85374', features: ['DC charging', 'Retail center', 'Family seating'], latitude: 33.62953, longitude: -112.37414 },
  { name: 'Goodyear EV Gateway', category: 'sustainable_ev_hubs', address: '1500 N Litchfield Rd, Goodyear, AZ 85395', features: ['High-speed charging', 'Freeway nearby', 'Wide stalls'], latitude: 33.46265, longitude: -112.35708 },
  { name: 'Avondale Quick Charge Court', category: 'sustainable_ev_hubs', address: '9930 W McDowell Rd, Avondale, AZ 85392', features: ['Quick charge bays', 'Food court nearby', '24/7 lot'], latitude: 33.46541, longitude: -112.27506 },
  { name: 'Chandler Fashion EV Deck', category: 'sustainable_ev_hubs', address: '3111 W Chandler Blvd, Chandler, AZ 85226', features: ['Mall charging', 'Indoor access', 'Family rest area'], latitude: 33.3037, longitude: -111.89808 },
  { name: 'Gilbert Heritage Charge Lot', category: 'sustainable_ev_hubs', address: '222 N Ash St, Gilbert, AZ 85234', features: ['Town center', 'Dual chargers', 'Park access'], latitude: 33.35476, longitude: -111.78992 },
  { name: 'Queen Creek EV Park', category: 'sustainable_ev_hubs', address: '20464 E Riggs Rd, Queen Creek, AZ 85142', features: ['Solar charging', 'Open daily', 'Large parking bays'], latitude: 33.21862, longitude: -111.65181 },
  { name: 'ASU West EV Hub', category: 'sustainable_ev_hubs', address: '4701 W Thunderbird Rd, Phoenix, AZ 85069', features: ['Campus chargers', 'Public access', 'Walkable plaza'], latitude: 33.61036, longitude: -112.16003 },
  { name: 'Papago Park Charge Loop', category: 'sustainable_ev_hubs', address: '625 N Galvin Pkwy, Phoenix, AZ 85008', features: ['Park access', 'Scenic stop', 'Level 2 charging'], latitude: 33.4559, longitude: -111.94931 },
  { name: 'Sky Harbor East EV Plaza', category: 'sustainable_ev_hubs', address: '402 S 40th St, Phoenix, AZ 85034', features: ['Airport-adjacent', 'Rapid charging', 'Ride-share ready'], latitude: 33.44482, longitude: -111.99598 },
  { name: 'Camelback Corridor EV Point', category: 'sustainable_ev_hubs', address: '2375 E Camelback Rd, Phoenix, AZ 85016', features: ['Office district', 'Fast charge', 'Covered drive-up'], latitude: 33.50957, longitude: -112.03198 },
  { name: 'Mesa Riverview EV Landing', category: 'sustainable_ev_hubs', address: '1061 N Dobson Rd, Mesa, AZ 85201', features: ['Shopping center', 'DC fast charging', 'Shaded stalls'], latitude: 33.43456, longitude: -111.87624 },
  { name: 'Old Town Scottsdale Charge Court', category: 'sustainable_ev_hubs', address: '7135 E Camelback Rd, Scottsdale, AZ 85251', features: ['Downtown access', 'Fast charging', 'Night lighting'], latitude: 33.5029, longitude: -111.92884 },
  { name: 'South Mountain EV Base', category: 'sustainable_ev_hubs', address: '1020 E Baseline Rd, Phoenix, AZ 85042', features: ['Trailhead nearby', 'Covered parking', 'Level 2 charging'], latitude: 33.37813, longitude: -112.05994 },
  { name: 'Maryvale EV Connect', category: 'sustainable_ev_hubs', address: '5102 W Indian School Rd, Phoenix, AZ 85031', features: ['Community charging', 'Bus access', 'Wide aisles'], latitude: 33.49519, longitude: -112.16976 },
  { name: 'Paradise Valley Charge Commons', category: 'sustainable_ev_hubs', address: '4568 E Cactus Rd, Phoenix, AZ 85032', features: ['Neighborhood chargers', 'Retail nearby', 'Easy access'], latitude: 33.59651, longitude: -111.98262 },

  { name: 'Phoenix Community Donation Center', category: 'reuse_donation_center', address: '9830 N Metro Pkwy W, Phoenix, AZ 85051', features: ['Furniture donations', 'Household goods', 'Drop-off dock'], latitude: 33.57631, longitude: -112.11908 },
  { name: 'Tempe Reuse Collective', category: 'reuse_donation_center', address: '2150 E Orange St, Tempe, AZ 85281', features: ['Clothing reuse', 'Student essentials', 'Electronics intake'], latitude: 33.43125, longitude: -111.89487 },
  { name: 'Mesa Give Back Depot', category: 'reuse_donation_center', address: '245 N Country Club Dr, Mesa, AZ 85201', features: ['Donation bays', 'Book reuse shelf', 'Volunteer sorting'], latitude: 33.41937, longitude: -111.83995 },
  { name: 'Glendale Second Life Center', category: 'reuse_donation_center', address: '5800 W Glenn Dr, Glendale, AZ 85301', features: ['Home goods', 'Clothing drop-off', 'Community pickup'], latitude: 33.53457, longitude: -112.18476 },
  { name: 'Scottsdale Neighborhood Donation Hub', category: 'reuse_donation_center', address: '8220 E Indian Bend Rd, Scottsdale, AZ 85250', features: ['Closet cleanout', 'Book donations', 'Volunteer desk'], latitude: 33.53836, longitude: -111.90343 },
  { name: 'Chandler Reuse Resource House', category: 'reuse_donation_center', address: '610 N Alma School Rd, Chandler, AZ 85224', features: ['School supplies', 'Housewares', 'Small electronics'], latitude: 33.31467, longitude: -111.85987 },
  { name: 'Gilbert Donation Exchange', category: 'reuse_donation_center', address: '868 N Gilbert Rd, Gilbert, AZ 85234', features: ['Furniture accepted', 'Donation receipts', 'Sorting room'], latitude: 33.36511, longitude: -111.78922 },
  { name: 'Peoria Reuse Barn', category: 'reuse_donation_center', address: '7540 W Peoria Ave, Peoria, AZ 85345', features: ['Appliance donations', 'Bicycle intake', 'Family services'], latitude: 33.58244, longitude: -112.22144 },
  { name: 'Avondale Give Again Center', category: 'reuse_donation_center', address: '1460 N Dysart Rd, Avondale, AZ 85392', features: ['Household donations', 'Weekend hours', 'Covered unloading'], latitude: 33.46297, longitude: -112.34076 },
  { name: 'Goodyear ReHome Depot', category: 'reuse_donation_center', address: '1400 N Litchfield Rd, Goodyear, AZ 85395', features: ['Reusable furniture', 'Office donations', 'Shelter partnerships'], latitude: 33.46212, longitude: -112.35729 },
  { name: 'Surprise Donation Dock', category: 'reuse_donation_center', address: '13939 W Bell Rd, Surprise, AZ 85374', features: ['Drive-through donation', 'Books and toys', 'Volunteer team'], latitude: 33.63934, longitude: -112.36053 },
  { name: 'Downtown Phoenix Reuse Corner', category: 'reuse_donation_center', address: '905 N 4th St, Phoenix, AZ 85004', features: ['Urban drop-off', 'Clothing reuse', 'Student move-out support'], latitude: 33.45802, longitude: -112.06891 },
  { name: 'Biltmore Donation Annex', category: 'reuse_donation_center', address: '2432 E Highland Ave, Phoenix, AZ 85016', features: ['Designer resale donations', 'Household goods', 'Easy parking'], latitude: 33.50593, longitude: -112.03057 },
  { name: 'Arcadia Reuse Market', category: 'reuse_donation_center', address: '3740 E Indian School Rd, Phoenix, AZ 85018', features: ['Vintage goods', 'Wardrobe donations', 'Community events'], latitude: 33.49448, longitude: -112.0015 },
  { name: 'Maryvale Donation Network', category: 'reuse_donation_center', address: '5101 W Thomas Rd, Phoenix, AZ 85031', features: ['Large-item intake', 'Curbside unload', 'Food pantry partner'], latitude: 33.48052, longitude: -112.16912 },
  { name: 'North Mountain Reuse Hub', category: 'reuse_donation_center', address: '10620 N 32nd St, Phoenix, AZ 85028', features: ['Book and media donations', 'Home decor', 'Community support'], latitude: 33.58367, longitude: -112.01357 },
  { name: 'Mesa East Donation Works', category: 'reuse_donation_center', address: '7110 E Main St, Mesa, AZ 85207', features: ['Donation drive lane', 'Electronics intake', 'Local redistribution'], latitude: 33.41697, longitude: -111.67812 },
  { name: 'Tempe Campus Move-Out Reuse', category: 'reuse_donation_center', address: '1111 S Rural Rd, Tempe, AZ 85281', features: ['Dorm essentials', 'Mini-fridges', 'Student volunteer sorting'], latitude: 33.41857, longitude: -111.92689 },
  { name: 'Old Town Scottsdale Give Spot', category: 'reuse_donation_center', address: '7044 E 5th Ave, Scottsdale, AZ 85251', features: ['Fashion donations', 'Accessory bins', 'Local charity pickup'], latitude: 33.49781, longitude: -111.92948 },
  { name: 'Queen Creek Reuse Porch', category: 'reuse_donation_center', address: '21802 S Ellsworth Rd, Queen Creek, AZ 85142', features: ['Kids items', 'Seasonal goods', 'Weekend drop-off'], latitude: 33.24823, longitude: -111.63589 },
  { name: 'Laveen Reuse Transfer Point', category: 'reuse_donation_center', address: '5130 W Baseline Rd, Laveen Village, AZ 85339', features: ['Household collections', 'Furniture accepted', 'Shelter support'], latitude: 33.37864, longitude: -112.17044 },
  { name: 'Paradise Valley Reuse Station', category: 'reuse_donation_center', address: '12621 N Paradise Village Pkwy W, Phoenix, AZ 85032', features: ['Closet donations', 'Book drop', 'Easy access lot'], latitude: 33.60156, longitude: -111.98642 },
  { name: 'South Phoenix Give Back Point', category: 'reuse_donation_center', address: '1601 E Southern Ave, Phoenix, AZ 85040', features: ['Housewares', 'Textiles', 'Community aid partner'], latitude: 33.39266, longitude: -112.04771 },
  { name: 'West Mesa Reuse Exchange', category: 'reuse_donation_center', address: '1325 W Guadalupe Rd, Mesa, AZ 85202', features: ['Kitchen goods', 'Donation dock', 'Volunteer intake'], latitude: 33.36284, longitude: -111.86211 },
  { name: 'Ahwatukee Donation Depot', category: 'reuse_donation_center', address: '4747 E Chandler Blvd, Phoenix, AZ 85048', features: ['Quick drop-off', 'Family donations', 'Community reuse shelf'], latitude: 33.3056, longitude: -111.98151 },

  { name: 'Phoenix Eco Drop-Off Station', category: 'recycling_specialized_waste_dropoff', address: '30205 N Black Canyon Hwy, Phoenix, AZ 85085', features: ['E-waste collection', 'Battery recycling', 'Paint disposal days'], latitude: 33.75849, longitude: -112.11703 },
  { name: 'Scottsdale Specialty Recycling Site', category: 'recycling_specialized_waste_dropoff', address: '9191 E San Salvador Dr, Scottsdale, AZ 85258', features: ['Textile recycling', 'Document shredding events', 'Light bulb drop-off'], latitude: 33.58556, longitude: -111.88102 },
  { name: 'Chandler Waste Diversion Center', category: 'recycling_specialized_waste_dropoff', address: '955 E Queen Creek Rd, Chandler, AZ 85286', features: ['Hazardous household waste', 'Appliance recycling', 'Oil disposal'], latitude: 33.26122, longitude: -111.8247 },
  { name: 'Tempe E-Waste Turn-In Point', category: 'recycling_specialized_waste_dropoff', address: '8403 S Hardy Dr, Tempe, AZ 85284', features: ['Computer recycling', 'Cable drop-off', 'Battery bins'], latitude: 33.33921, longitude: -111.96431 },
  { name: 'Mesa Household Hazard Center', category: 'recycling_specialized_waste_dropoff', address: '2412 N Center St, Mesa, AZ 85201', features: ['Paints and solvents', 'Chemical drop-off', 'Appointment days'], latitude: 33.45908, longitude: -111.83136 },
  { name: 'Glendale Green Materials Yard', category: 'recycling_specialized_waste_dropoff', address: '6210 W Myrtle Ave, Glendale, AZ 85301', features: ['Metal recycling', 'Appliance intake', 'Electronics bins'], latitude: 33.54212, longitude: -112.19141 },
  { name: 'Peoria Hard-To-Recycle Hub', category: 'recycling_specialized_waste_dropoff', address: '8550 W Pinnacle Peak Rd, Peoria, AZ 85383', features: ['Styrofoam collection', 'Ink cartridge drop', 'E-waste days'], latitude: 33.69836, longitude: -112.24277 },
  { name: 'Goodyear Material Recovery Point', category: 'recycling_specialized_waste_dropoff', address: '498 S 157th Ave, Goodyear, AZ 85338', features: ['Cardboard compactors', 'Glass collection', 'Oil recycling'], latitude: 33.44208, longitude: -112.39871 },
  { name: 'Avondale Special Waste Lot', category: 'recycling_specialized_waste_dropoff', address: '1007 S Central Ave, Avondale, AZ 85323', features: ['Household hazardous waste', 'Motor oil', 'Battery drop-off'], latitude: 33.4241, longitude: -112.34942 },
  { name: 'Surprise Responsible Recycling Center', category: 'recycling_specialized_waste_dropoff', address: '17402 N El Mirage Rd, Surprise, AZ 85378', features: ['TV recycling', 'Electronics intake', 'Bulb collection'], latitude: 33.64144, longitude: -112.32485 },
  { name: 'Downtown Phoenix Circular Materials Hub', category: 'recycling_specialized_waste_dropoff', address: '200 N 17th Ave, Phoenix, AZ 85007', features: ['Paper shredding events', 'Battery bins', 'Plastic film drop'], latitude: 33.45177, longitude: -112.09563 },
  { name: 'Biltmore Recycling Annex', category: 'recycling_specialized_waste_dropoff', address: '2502 E Highland Ave, Phoenix, AZ 85016', features: ['Small electronics', 'Ink and toner', 'Glass collection'], latitude: 33.50573, longitude: -112.02968 },
  { name: 'Arcadia Tech Recycling Point', category: 'recycling_specialized_waste_dropoff', address: '4201 E Thomas Rd, Phoenix, AZ 85018', features: ['Laptop recycling', 'Peripheral drop', 'Secure collection bins'], latitude: 33.48082, longitude: -111.99138 },
  { name: 'North Phoenix Battery & Bulb Depot', category: 'recycling_specialized_waste_dropoff', address: '12450 N 32nd St, Phoenix, AZ 85032', features: ['Battery drop', 'Light bulb recycling', 'Small e-waste'], latitude: 33.59988, longitude: -112.01407 },
  { name: 'Paradise Valley Specialty Recycle Stop', category: 'recycling_specialized_waste_dropoff', address: '12601 N Tatum Blvd, Phoenix, AZ 85032', features: ['Textiles', 'Printer cartridges', 'Medical sharps events'], latitude: 33.60198, longitude: -111.97947 },
  { name: 'Maryvale Recycle & Recover Yard', category: 'recycling_specialized_waste_dropoff', address: '6601 W Thomas Rd, Phoenix, AZ 85033', features: ['Metal drop', 'Appliance recycling', 'Cardboard baling'], latitude: 33.48094, longitude: -112.20132 },
  { name: 'South Mountain Waste Diversion Yard', category: 'recycling_specialized_waste_dropoff', address: '300 E Southern Ave, Phoenix, AZ 85040', features: ['Oil disposal', 'Chemical turn-in', 'Seasonal events'], latitude: 33.39286, longitude: -112.07026 },
  { name: 'Laveen Recycle Service Center', category: 'recycling_specialized_waste_dropoff', address: '5130 W Dobbins Rd, Laveen Village, AZ 85339', features: ['Household batteries', 'Paint collection', 'Large-item days'], latitude: 33.36308, longitude: -112.17046 },
  { name: 'Gilbert Circular Drop-Off Yard', category: 'recycling_specialized_waste_dropoff', address: '300 E Houston Ave, Gilbert, AZ 85234', features: ['Electronics bins', 'Styrofoam days', 'Glass recycling'], latitude: 33.35237, longitude: -111.78263 },
  { name: 'Queen Creek Eco Disposal Point', category: 'recycling_specialized_waste_dropoff', address: '19715 S 220th St, Queen Creek, AZ 85142', features: ['Paint cans', 'Batteries', 'Appliance collection'], latitude: 33.23891, longitude: -111.61732 },
  { name: 'ASU West Specialty Recycle Hub', category: 'recycling_specialized_waste_dropoff', address: '4701 W Thunderbird Rd, Phoenix, AZ 85069', features: ['Campus e-waste', 'Printer cartridges', 'Battery recycling'], latitude: 33.61011, longitude: -112.16052 },
  { name: 'Mesa East Diversion Site', category: 'recycling_specialized_waste_dropoff', address: '7110 E Main St, Mesa, AZ 85207', features: ['Electronics days', 'Bulk item drop', 'Hazardous waste events'], latitude: 33.41679, longitude: -111.67834 },
  { name: 'Old Town Scottsdale Waste Recovery Point', category: 'recycling_specialized_waste_dropoff', address: '7380 E 2nd St, Scottsdale, AZ 85251', features: ['Textiles', 'Light bulbs', 'Paper shredding days'], latitude: 33.49301, longitude: -111.92027 },
  { name: 'Papago Park Recycle Exchange', category: 'recycling_specialized_waste_dropoff', address: '1000 N College Ave, Tempe, AZ 85288', features: ['Glass and cans', 'Battery bins', 'Small electronics'], latitude: 33.43931, longitude: -111.93551 },
  { name: 'Deer Valley Reuse Materials Center', category: 'recycling_specialized_waste_dropoff', address: '2440 W Deer Valley Rd, Phoenix, AZ 85027', features: ['Appliances', 'Oil recycling', 'Cardboard drop-off'], latitude: 33.68352, longitude: -112.1117 },
];

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += character;
  }

  values.push(current);
  return values;
}

function randomCapacity() {
  return Math.floor(Math.random() * 3) + 4;
}

function toNumber(value, fieldName) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    throw new Error(`Invalid numeric value for ${fieldName}: ${value}`);
  }

  return parsedValue;
}

async function seedCarsFromCsv() {
  const fileContents = fs.readFileSync(CARS_CSV_PATH, 'utf8').trim();
  const lines = fileContents.split(/\r?\n/);

  if (lines.length < 2) {
    throw new Error('co2.csv does not contain any car records to seed.');
  }

  const [, ...records] = lines;

  await pool.query('BEGIN');

  try {
    for (const record of records) {
      const [
        make,
        model,
        vehicleClass,
        engineSize,
        cylinders,
        transmission,
        fuelType,
        fuelConsumptionCity,
        fuelConsumptionHwy,
        fuelConsumptionComb,
        fuelConsumptionCombMpg,
        co2Emissions,
      ] = parseCsvLine(record);

      await pool.query(
        `
          INSERT INTO cars (
            make,
            model,
            vehicle_class,
            engine_size_l,
            cylinders,
            transmission,
            fuel_type,
            fuel_consumption_city_l_per_100km,
            fuel_consumption_hwy_l_per_100km,
            fuel_consumption_comb_l_per_100km,
            fuel_consumption_comb_mpg,
            co2_emissions_g_per_km,
            capacity
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12, $13
          )
        `,
        [
          make,
          model,
          vehicleClass,
          toNumber(engineSize, 'Engine Size(L)'),
          Math.round(toNumber(cylinders, 'Cylinders')),
          transmission,
          fuelType,
          toNumber(fuelConsumptionCity, 'Fuel Consumption City (L/100 km)'),
          toNumber(fuelConsumptionHwy, 'Fuel Consumption Hwy (L/100 km)'),
          toNumber(fuelConsumptionComb, 'Fuel Consumption Comb (L/100 km)'),
          Math.round(toNumber(fuelConsumptionCombMpg, 'Fuel Consumption Comb (mpg)')),
          Math.round(toNumber(co2Emissions, 'CO2 Emissions(g/km)')),
          randomCapacity(),
        ]
      );
    }

    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }

  return records.length;
}

async function seedProfiles() {
  const profileIdMap = new Map();

  for (const profile of demoProfiles) {
    const result = await pool.query(
      `
        INSERT INTO profiles (
          user_name,
          car_id,
          total_points,
          email,
          age,
          gender,
          licence_no
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `,
      [
        profile.userName,
        profile.carId,
        profile.totalPoints,
        profile.email,
        profile.age,
        profile.gender,
        profile.licenceNo,
      ]
    );

    profileIdMap.set(profile.key, result.rows[0].id);
  }

  return profileIdMap;
}

async function seedTrips(profileIdMap) {
  const tripIdMap = new Map();

  for (const trip of demoTrips) {
    const savedTrip = await createTripRecord({
      userId: profileIdMap.get(trip.profileKey),
      displayName: trip.displayName,
      routeType: trip.routeType,
      routeTitle: trip.routeTitle,
      originLabel: trip.originLabel,
      destinationLabel: trip.destinationLabel,
      distanceMeters: trip.distanceMeters,
      durationSeconds: trip.durationSeconds,
      co2Kg: trip.co2Kg,
      co2SavedKg: trip.co2SavedKg,
      availableSeats: trip.availableSeats,
      status: trip.status,
      startedAt: trip.startedAt,
      completedAt: trip.completedAt,
      pathPoints: trip.pathPoints,
      metadata: trip.metadata,
    });

    tripIdMap.set(trip.key, savedTrip.id);
  }

  return tripIdMap;
}

async function seedTripUsers(profileIdMap, tripIdMap) {
  for (const tripUser of demoTripUsers) {
    const driverId = profileIdMap.get(tripUser.driverKey);
    const riderId = profileIdMap.get(tripUser.riderKey);

    await pool.query(
      `
        INSERT INTO trip_users (
          trip_id,
          driver_id,
          rider_id,
          user_id,
          participant_role,
          joined_at
        )
        VALUES ($1, $2, $3, $3, $4, NOW())
        ON CONFLICT (trip_id, rider_id)
        DO NOTHING
      `,
      [
        tripIdMap.get(tripUser.tripKey),
        driverId,
        riderId,
        driverId === riderId ? 'driver' : 'rider',
      ]
    );
  }

  return demoTripUsers.length;
}

async function seedEcoDestinations() {
  for (const destination of ecoDestinations) {
    await pool.query(
      `
        INSERT INTO eco_destinations (
          name,
          category,
          address,
          features,
          latitude,
          longitude
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, $6)
      `,
      [
        destination.name,
        destination.category,
        destination.address,
        JSON.stringify(destination.features),
        destination.latitude,
        destination.longitude,
      ]
    );
  }

  return ecoDestinations.length;
}

async function run() {
  const keepEmpty = process.argv.includes('--empty');

  console.log('Resetting Transit Green database...');
  await resetSchema();
  await ensureSchema();

  if (keepEmpty) {
    console.log('Created a fresh schema with no seed records.');
    return;
  }

  const carCount = await seedCarsFromCsv();
  const profileIdMap = await seedProfiles();
  const tripIdMap = await seedTrips(profileIdMap);
  const tripUserCount = await seedTripUsers(profileIdMap, tripIdMap);
  const ecoDestinationCount = await seedEcoDestinations();

  console.log(
    `Created a fresh schema and inserted ${carCount} cars, ${profileIdMap.size} profiles, ${tripIdMap.size} trips, ${tripUserCount} trip-user records, and ${ecoDestinationCount} eco destinations.`
  );
}

run()
  .catch((error) => {
    console.error('Failed to reset and seed the database.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
