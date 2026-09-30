import { describe, expect, it } from 'vitest';
import { buildGraphQLOperation, schemaFromSdl, validateQuery } from '../../packages/core/src/index.js';

const schema = schemaFromSdl(`
  enum Species { DOG CAT }
  type Owner { id: ID! name: String! patients: [Patient!]! }
  type Visit { id: ID! date: String! reason: String vet: Owner }
  type Patient {
    id: ID!
    name: String!
    species: Species!
    weight(unit: String = "kg"): Float
    owner: Owner
    visits(limit: Int!): [Visit!]!
    legacyCode: String @deprecated(reason: "gone")
  }
  union SearchResult = Patient | Owner
  input PatientInput { name: String! species: Species! notes: String tags: [String!] = [] }
  type Query {
    patient(id: ID!, includeArchived: Boolean): Patient
    patients: [Patient!]!
    search(term: String!): [SearchResult!]!
    version: String!
  }
  type Mutation { addPatient(input: PatientInput!): Patient! }
  type Subscription { patientUpdated(id: ID): Patient }
`);

describe('GraphQL operation builder', () => {
  it('builds a query with variables for the arguments and a nested selection', () => {
    const op = buildGraphQLOperation(schema, 'Query.patient');
    expect(op).toMatchObject({ operation: 'query', operationName: 'Patient', variables: { id: '', includeArchived: false } });
    expect(op.query).toContain('query Patient($id: ID!, $includeArchived: Boolean)');
    expect(op.query).toContain('patient(id: $id, includeArchived: $includeArchived)');
    // leaves, then objects; fields with required arguments and deprecated fields are left out; Owner → patients is a cycle
    expect(op.query).toMatch(/owner \{\s+id\s+name\s+\}/);
    expect(op.query).not.toContain('visits');
    expect(op.query).not.toContain('legacyCode');
    expect(validateQuery(schema, op.query)).toEqual([]);
  });

  it('only required arguments, depth 0, and placeholder values for input objects and enums', () => {
    expect(buildGraphQLOperation(schema, 'patient', { includeOptionalArgs: false, depth: 0 }).query).toBe('query Patient($id: ID!) {\n  patient(id: $id) {\n    id\n    name\n    species\n    weight\n  }\n}');
    const add = buildGraphQLOperation(schema, 'Mutation.addPatient');
    expect(add.operation).toBe('mutation');
    expect(add.variables).toEqual({ input: { name: '', species: 'DOG' } });
    expect(validateQuery(schema, add.query)).toEqual([]);
  });

  it('unions, leaves and subscriptions', () => {
    const search = buildGraphQLOperation(schema, 'search');
    expect(search.query).toContain('... on Patient');
    expect(search.query).toContain('... on Owner');
    expect(validateQuery(schema, search.query)).toEqual([]);
    expect(buildGraphQLOperation(schema, 'version').query).toBe('query Version {\n  version\n}');
    const sub = buildGraphQLOperation(schema, 'subscription.patientUpdated');
    expect(sub.operation).toBe('subscription');
    expect(validateQuery(schema, sub.query)).toEqual([]);
  });

  it('says which root fields exist when the field is unknown', () => {
    expect(() => buildGraphQLOperation(schema, 'Query.nope')).toThrow(/No root field "Query.nope"/);
    try {
      buildGraphQLOperation(schema, 'nope');
    } catch (e) {
      expect(JSON.stringify((e as { suggestions?: string[] }).suggestions)).toContain('Query.patient');
    }
  });
});
