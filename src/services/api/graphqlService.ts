/**
 * GraphQL service — AWS AppSync integration via aws-amplify v6.
 *
 * Defines all GraphQL operations expected from the tour-data-api backend.
 * Query/mutation field names follow the standard AppSync DynamoDB resolver
 * naming convention. Update these strings if the actual backend schema differs.
 *
 * NOTE: All calls are wrapped so that network / auth errors surface as thrown
 * Error instances that the calling layer (dataService) can catch and act upon.
 */

import { generateClient } from 'aws-amplify/api';
import { Rider, Ride, CheckIn, Stage, StageType } from '../../types/models';
import { CheckInRequest, GetCheckInsQuery, GetRidesQuery } from '../../types/api';
import { isAmplifyConfigured } from '../../config/amplify';

// ============================================================================
// GraphQL document strings
// NOTE: Field names must match the tour-data-api AppSync schema.
// ============================================================================

const RIDER_FIELDS = `
  riderId
  name
  email
  phone
  emergencyContactName
  emergencyContactPhone
  qrCodeData
`;

const STAGE_FIELDS = `
  stageId
  stageNumber
  type
  name
  distanceFromStart
  estimatedTimeFromStart
`;

const RIDE_FIELDS = `
  rideId
  date
  name
  startLocation
  finishLocation
  totalDistance
  status
  startedAt
  completedAt
  closedAt
  notes
  stages {
    ${STAGE_FIELDS}
  }
`;

const CHECKIN_FIELDS = `
  checkInId
  riderId
  rideId
  stageId
  status
  timestamp
  checkedInBy
  method
  notes
  location {
    latitude
    longitude
  }
`;

const LIST_RIDERS_QUERY = /* GraphQL */ `
  query ListRiders($limit: Int, $nextToken: String) {
    listRiders(limit: $limit, nextToken: $nextToken) {
      items {
        ${RIDER_FIELDS}
      }
      nextToken
    }
  }
`;

const LIST_RIDES_QUERY = /* GraphQL */ `
  query ListRides($filter: ModelRideFilterInput, $limit: Int, $nextToken: String) {
    listRides(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items {
        ${RIDE_FIELDS}
      }
      nextToken
    }
  }
`;

const GET_RIDE_QUERY = /* GraphQL */ `
  query GetRide($rideId: ID!) {
    getRide(rideId: $rideId) {
      ${RIDE_FIELDS}
    }
  }
`;

const LIST_CHECKINS_BY_RIDE_QUERY = /* GraphQL */ `
  query ListCheckInsByRide(
    $rideId: ID!
    $filter: ModelCheckInFilterInput
    $limit: Int
    $nextToken: String
  ) {
    listCheckInsByRide(
      rideId: $rideId
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        ${CHECKIN_FIELDS}
      }
      nextToken
    }
  }
`;

const CREATE_CHECKIN_MUTATION = /* GraphQL */ `
  mutation CreateCheckIn($input: CreateCheckInInput!) {
    createCheckIn(input: $input) {
      ${CHECKIN_FIELDS}
    }
  }
`;

// ============================================================================
// Client factory (lazy-initialised singleton)
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any = null;

const getClient = () => {
  if (!isAmplifyConfigured()) {
    throw new Error('Amplify is not configured. Set environment variables to enable API access.');
  }
  if (!_client) {
    _client = generateClient();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return _client as any;
};

// ============================================================================
// Pagination helper
// ============================================================================

/**
 * Fetch all pages of a list query and return the flat array of items.
 * The query must accept `nextToken` and return `{ items, nextToken }`.
 */
async function fetchAllPages<T>(
  query: string,
  variables: Record<string, unknown>,
  extractPage: (data: unknown) => { items: T[]; nextToken?: string | null }
): Promise<T[]> {
  const client = getClient();
  const all: T[] = [];
  let nextToken: string | null = null;

  do {
    const vars = nextToken ? { ...variables, nextToken } : variables;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (client.graphql as any)({ query, variables: vars });
    const page = extractPage(response.data);
    all.push(...page.items);
    nextToken = page.nextToken ?? null;
  } while (nextToken);

  return all;
}

// ============================================================================
// Public API
// ============================================================================

/** Fetch all rider profiles from the backend. */
export const fetchRiders = async (): Promise<Rider[]> => {
  return fetchAllPages<Rider>(
    LIST_RIDERS_QUERY,
    { limit: 100 },
    (data) => (data as { listRiders: { items: Rider[]; nextToken?: string } }).listRiders
  );
};

/** Fetch rides, optionally filtered by date range or status. */
export const fetchRides = async (queryParams?: GetRidesQuery): Promise<Ride[]> => {
  const filter: Record<string, unknown> = {};
  if (queryParams?.status) filter['status'] = { eq: queryParams.status };
  if (queryParams?.startDate) filter['date'] = { ge: queryParams.startDate };
  if (queryParams?.endDate) {
    filter['date'] = { ...(filter['date'] as Record<string, unknown>), le: queryParams.endDate };
  }

  return fetchAllPages<Ride>(
    LIST_RIDES_QUERY,
    { filter: Object.keys(filter).length ? filter : undefined, limit: 50 },
    (data) => (data as { listRides: { items: Ride[]; nextToken?: string } }).listRides
  );
};

/** Fetch a single ride by ID. */
export const fetchRideById = async (rideId: string): Promise<Ride | null> => {
  const client = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (client.graphql as any)({ query: GET_RIDE_QUERY, variables: { rideId } });
  return (response.data as { getRide: Ride | null }).getRide ?? null;
};

/**
 * Fetch check-ins for a ride, with optional rider/stage/status filters.
 * All pages are fetched automatically.
 */
export const fetchCheckIns = async (queryParams: GetCheckInsQuery): Promise<CheckIn[]> => {
  const filter: Record<string, unknown> = {};
  if (queryParams.riderId) filter['riderId'] = { eq: queryParams.riderId };
  if (queryParams.stageId) filter['stageId'] = { eq: queryParams.stageId };
  if (queryParams.status) filter['status'] = { eq: queryParams.status };

  return fetchAllPages<CheckIn>(
    LIST_CHECKINS_BY_RIDE_QUERY,
    {
      rideId: queryParams.rideId,
      filter: Object.keys(filter).length ? filter : undefined,
      limit: 200,
    },
    (data) =>
      (data as { listCheckInsByRide: { items: CheckIn[]; nextToken?: string } })
        .listCheckInsByRide
  );
};

/**
 * Submit a single check-in record to the backend.
 * Returns the created check-in (with server-assigned ID).
 */
export const submitCheckIn = async (req: CheckInRequest): Promise<CheckIn> => {
  const client = getClient();
  const input = {
    riderId: req.riderId,
    rideId: req.rideId,
    stageId: req.stageId,
    status: req.status,
    method: req.method,
    timestamp: new Date().toISOString(),
    notes: req.notes,
    location: req.location,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (client.graphql as any)({
    query: CREATE_CHECKIN_MUTATION,
    variables: { input },
  });
  return (response.data as { createCheckIn: CheckIn }).createCheckIn;
};

// ============================================================================
// Type guard helpers (used when mapping stages from raw API responses)
// ============================================================================

const VALID_STAGE_TYPES: string[] = Object.values(StageType);

export const isValidStageType = (value: unknown): value is StageType =>
  typeof value === 'string' && VALID_STAGE_TYPES.includes(value);

/** Parse stage type safely, defaulting to PIT_STOP for unknown values. */
export const parseStageType = (value: unknown): StageType => {
  if (isValidStageType(value)) return value;
  return StageType.PIT_STOP;
};

/** Normalise stages returned from the API (type field may differ from enum). */
export const normaliseStages = (stages: Stage[]): Stage[] =>
  stages.map((s) => ({ ...s, type: parseStageType(s.type) }));
