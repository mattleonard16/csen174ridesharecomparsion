import type { CommonPlaces, ServiceType } from '@/types'

// Common places for faster autocomplete
export const COMMON_PLACES: CommonPlaces = {
  // Bay Area Airports
  'san jose airport': {
    display_name: 'San Jose International Airport (SJC), San Jose, CA, USA',
    name: 'San Jose Airport (SJC)',
    lat: '37.3639',
    lon: '-121.9289',
  },
  sjc: {
    display_name: 'San Jose International Airport (SJC), San Jose, CA, USA',
    name: 'San Jose Airport (SJC)',
    lat: '37.3639',
    lon: '-121.9289',
  },
  sfo: {
    display_name: 'San Francisco International Airport (SFO), San Francisco, CA, USA',
    name: 'San Francisco Airport (SFO)',
    lat: '37.6213',
    lon: '-122.3790',
  },
  'san francisco airport': {
    display_name: 'San Francisco International Airport (SFO), San Francisco, CA, USA',
    name: 'San Francisco Airport (SFO)',
    lat: '37.6213',
    lon: '-122.3790',
  },
  'oakland airport': {
    display_name: 'Oakland International Airport (OAK), Oakland, CA, USA',
    name: 'Oakland Airport (OAK)',
    lat: '37.7126',
    lon: '-122.2197',
  },
  oak: {
    display_name: 'Oakland International Airport (OAK), Oakland, CA, USA',
    name: 'Oakland Airport (OAK)',
    lat: '37.7126',
    lon: '-122.2197',
  },

  // Major U.S. Airports
  lax: {
    display_name: 'Los Angeles International Airport (LAX), Los Angeles, CA, USA',
    name: 'Los Angeles Airport (LAX)',
    lat: '33.9425',
    lon: '-118.4085',
  },
  'los angeles airport': {
    display_name: 'Los Angeles International Airport (LAX), Los Angeles, CA, USA',
    name: 'Los Angeles Airport (LAX)',
    lat: '33.9425',
    lon: '-118.4085',
  },
  jfk: {
    display_name: 'John F. Kennedy International Airport (JFK), New York, NY, USA',
    name: 'JFK Airport (JFK)',
    lat: '40.6413',
    lon: '-73.7781',
  },
  'jfk airport': {
    display_name: 'John F. Kennedy International Airport (JFK), New York, NY, USA',
    name: 'JFK Airport (JFK)',
    lat: '40.6413',
    lon: '-73.7781',
  },
  ewr: {
    display_name: 'Newark Liberty International Airport (EWR), Newark, NJ, USA',
    name: 'Newark Airport (EWR)',
    lat: '40.6895',
    lon: '-74.1745',
  },
  'newark airport': {
    display_name: 'Newark Liberty International Airport (EWR), Newark, NJ, USA',
    name: 'Newark Airport (EWR)',
    lat: '40.6895',
    lon: '-74.1745',
  },
  ord: {
    display_name: "Chicago O'Hare International Airport (ORD), Chicago, IL, USA",
    name: "O'Hare Airport (ORD)",
    lat: '41.9742',
    lon: '-87.9073',
  },
  "o'hare airport": {
    display_name: "Chicago O'Hare International Airport (ORD), Chicago, IL, USA",
    name: "O'Hare Airport (ORD)",
    lat: '41.9742',
    lon: '-87.9073',
  },
  'chicago airport': {
    display_name: "Chicago O'Hare International Airport (ORD), Chicago, IL, USA",
    name: "O'Hare Airport (ORD)",
    lat: '41.9742',
    lon: '-87.9073',
  },
  atl: {
    display_name: 'Hartsfield-Jackson Atlanta International Airport (ATL), Atlanta, GA, USA',
    name: 'Atlanta Airport (ATL)',
    lat: '33.6407',
    lon: '-84.4277',
  },
  'atlanta airport': {
    display_name: 'Hartsfield-Jackson Atlanta International Airport (ATL), Atlanta, GA, USA',
    name: 'Atlanta Airport (ATL)',
    lat: '33.6407',
    lon: '-84.4277',
  },
  sea: {
    display_name: 'Seattle-Tacoma International Airport (SEA), Seattle, WA, USA',
    name: 'Seattle Airport (SEA)',
    lat: '47.4502',
    lon: '-122.3088',
  },
  'seattle airport': {
    display_name: 'Seattle-Tacoma International Airport (SEA), Seattle, WA, USA',
    name: 'Seattle Airport (SEA)',
    lat: '47.4502',
    lon: '-122.3088',
  },
  den: {
    display_name: 'Denver International Airport (DEN), Denver, CO, USA',
    name: 'Denver Airport (DEN)',
    lat: '39.8561',
    lon: '-104.6737',
  },
  'denver airport': {
    display_name: 'Denver International Airport (DEN), Denver, CO, USA',
    name: 'Denver Airport (DEN)',
    lat: '39.8561',
    lon: '-104.6737',
  },
  bos: {
    display_name: 'Boston Logan International Airport (BOS), Boston, MA, USA',
    name: 'Boston Airport (BOS)',
    lat: '42.3656',
    lon: '-71.0096',
  },
  'boston airport': {
    display_name: 'Boston Logan International Airport (BOS), Boston, MA, USA',
    name: 'Boston Airport (BOS)',
    lat: '42.3656',
    lon: '-71.0096',
  },
  'logan airport': {
    display_name: 'Boston Logan International Airport (BOS), Boston, MA, USA',
    name: 'Boston Airport (BOS)',
    lat: '42.3656',
    lon: '-71.0096',
  },
  dfw: {
    display_name: 'Dallas/Fort Worth International Airport (DFW), Dallas, TX, USA',
    name: 'Dallas Airport (DFW)',
    lat: '32.8968',
    lon: '-97.0372',
  },
  'dallas airport': {
    display_name: 'Dallas/Fort Worth International Airport (DFW), Dallas, TX, USA',
    name: 'Dallas Airport (DFW)',
    lat: '32.8968',
    lon: '-97.0372',
  },

  // Bay Area Local Places
  'santa clara university': {
    display_name: 'Santa Clara University, Santa Clara, CA, USA',
    name: 'Santa Clara University',
    lat: '37.3496',
    lon: '-121.9390',
  },
  'stanford university': {
    display_name: 'Stanford University, Stanford, CA, USA',
    name: 'Stanford University',
    lat: '37.4275',
    lon: '-122.1697',
  },
  cupertino: {
    display_name: 'Cupertino, CA, USA',
    name: 'Cupertino',
    lat: '37.3230',
    lon: '-122.0322',
  },
  'apple park': {
    display_name: 'Apple Park, Cupertino, CA, USA',
    name: 'Apple Park',
    lat: '37.3349',
    lon: '-122.0090',
  },
  google: {
    display_name: 'Googleplex, Mountain View, CA, USA',
    name: 'Google Headquarters',
    lat: '37.4220',
    lon: '-122.0841',
  },
  'mountain view': {
    display_name: 'Mountain View, CA, USA',
    name: 'Mountain View',
    lat: '37.3861',
    lon: '-122.0839',
  },
  'palo alto': {
    display_name: 'Palo Alto, CA, USA',
    name: 'Palo Alto',
    lat: '37.4419',
    lon: '-122.1430',
  },
  'san jose': {
    display_name: 'San Jose, CA, USA',
    name: 'San Jose',
    lat: '37.3382',
    lon: '-121.8863',
  },
  'santa clara': {
    display_name: 'Santa Clara, CA, USA',
    name: 'Santa Clara',
    lat: '37.3541',
    lon: '-121.9552',
  },
  sunnyvale: {
    display_name: 'Sunnyvale, CA, USA',
    name: 'Sunnyvale',
    lat: '37.3688',
    lon: '-122.0363',
  },
  fremont: {
    display_name: 'Fremont, CA, USA',
    name: 'Fremont',
    lat: '37.5485',
    lon: '-121.9886',
  },
  'san francisco': {
    display_name: 'San Francisco, CA, USA',
    name: 'San Francisco',
    lat: '37.7749',
    lon: '-122.4194',
  },
  'downtown san jose': {
    display_name: 'Downtown San Jose, San Jose, CA, USA',
    name: 'Downtown San Jose',
    lat: '37.3382',
    lon: '-121.8863',
  },
}

export const DEFAULT_SERVICES: ServiceType[] = ['uber', 'lyft', 'taxi', 'waymo']

// API endpoints and configuration
export const API_CONFIG = {
  NOMINATIM_BASE_URL: 'https://nominatim.openstreetmap.org/search',
  NOMINATIM_REVERSE_URL: 'https://nominatim.openstreetmap.org/reverse',
  OSRM_BASE_URL: 'https://router.project-osrm.org/route/v1/driving',
  USER_AGENT: 'RideCompareApp/1.0',
  SEARCH_LIMIT: 5,
  CACHE_TTL: 300000, // 5 minutes in milliseconds
  ROUTE_CACHE_TTL: 600000, // 10 minutes in milliseconds
  REQUEST_TIMEOUT_MS: 8000,
  MAX_RETRIES: 2,
} as const

// UI constants
export const UI_CONFIG = {
  DEBOUNCE_DELAY: 300, // milliseconds
  MAX_SUGGESTIONS: 5,
  LOADING_TIMEOUT: 10000, // 10 seconds
} as const
