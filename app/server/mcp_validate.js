// Minimal JSON-Schema-subset validator for MCP tool inputs.
//
// WHY a home-grown validator: the repo avoids new runtime dependencies; the
// MCP SDK already bundles zod internally, but that's inside the SDK boundary
// and not re-exported for our server-side route validation.
//
// Supported schema subset (root must be type:'object'):
//   root:      { type: 'object', properties, required?, additionalProperties: false }
//   property types:
//     'string'  — minLength?, maxLength?, enum? (array of strings), pattern? (RegExp source string)
//     'number'  — minimum?, maximum?
//     'integer' — same as number but rejects non-integer values (including 1.5)
//     'boolean' — no extra constraints
//     'array'   — items: { type: 'string' }, maxItems?
//     nullable  — type: ['string', 'null'] (any supported type plus 'null' in an array)
//
// Guarantees:
//   - undefined args treated as {} (valid when no required fields)
//   - unknown keys rejected and named in the error
//   - required missing named in the error
//   - type mismatches named with expected type
//   - absent optional properties are left absent in value (no default injection)
//   - never throws on bad args (only on a malformed schema is throwing acceptable)

// Resolve the set of allowed types from a property's type field.
// Returns { types: Set<string>, nullable: boolean }
function resolveTypes(typeField) {
  if (Array.isArray(typeField)) {
    const nullable = typeField.includes('null')
    const types = new Set(typeField.filter(t => t !== 'null'))
    return { types, nullable }
  }
  return { types: new Set([typeField]), nullable: false }
}

// Validate a single value against a property schema. Returns null on success,
// or a human-readable error string on failure. key is used in error messages.
function validateProperty(key, value, propSchema) {
  const { types, nullable } = resolveTypes(propSchema.type)

  // Null handling: allowed only when nullable
  if (value === null) {
    if (nullable) return null
    return `'${key}' must not be null`
  }

  // Pick the primary (non-null) type to check
  // For mixed types (e.g. ['string', 'number']), check if value satisfies any
  let typeMatched = false
  for (const t of types) {
    if (t === 'string' && typeof value === 'string') { typeMatched = true; break }
    if (t === 'number' && typeof value === 'number') { typeMatched = true; break }
    if (t === 'integer' && typeof value === 'number') { typeMatched = true; break }
    if (t === 'boolean' && typeof value === 'boolean') { typeMatched = true; break }
    if (t === 'array' && Array.isArray(value)) { typeMatched = true; break }
  }
  if (!typeMatched) {
    const expected = [...types].join(' or ')
    return `'${key}' must be of type ${expected} (got ${Array.isArray(value) ? 'array' : typeof value})`
  }

  // Type-specific constraint checks — re-check which type matched to pick constraints
  if (types.has('string') && typeof value === 'string') {
    if (propSchema.minLength !== undefined && value.length < propSchema.minLength) {
      return `'${key}' must be at least ${propSchema.minLength} character(s) long`
    }
    if (propSchema.maxLength !== undefined && value.length > propSchema.maxLength) {
      return `'${key}' must be at most ${propSchema.maxLength} character(s) long`
    }
    if (propSchema.enum !== undefined && !propSchema.enum.includes(value)) {
      return `'${key}' must be one of: ${propSchema.enum.join(', ')}`
    }
    if (propSchema.pattern !== undefined && !new RegExp(propSchema.pattern).test(value)) {
      return `'${key}' does not match required pattern`
    }
  }

  if ((types.has('number') || types.has('integer')) && typeof value === 'number') {
    if (types.has('integer') && !Number.isInteger(value)) {
      return `'${key}' must be an integer (got ${value})`
    }
    if (propSchema.minimum !== undefined && value < propSchema.minimum) {
      return `'${key}' must be >= ${propSchema.minimum}`
    }
    if (propSchema.maximum !== undefined && value > propSchema.maximum) {
      return `'${key}' must be <= ${propSchema.maximum}`
    }
  }

  if (types.has('array') && Array.isArray(value)) {
    if (propSchema.maxItems !== undefined && value.length > propSchema.maxItems) {
      return `'${key}' must have at most ${propSchema.maxItems} item(s)`
    }
    if (propSchema.items) {
      const itemType = propSchema.items.type
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] !== itemType) {
          return `'${key}[${i}]' must be of type ${itemType}`
        }
      }
    }
  }

  return null
}

// Main export. Returns { ok: true, value } or { ok: false, error: '...' }.
// value is a shallow copy of args with only the known properties (absent
// optionals omitted — handlers supply their own defaults).
export function validateInput(schema, args) {
  // Non-object args (a string, number, array…) fail cleanly — the `in` checks
  // below would otherwise throw on primitives.
  if (args !== undefined && args !== null && (typeof args !== 'object' || Array.isArray(args))) {
    return { ok: false, error: 'arguments must be an object' }
  }
  const input = (args === undefined || args === null) ? {} : args
  const properties = schema.properties || {}
  const required = new Set(schema.required || [])

  // Reject unknown keys (additionalProperties: false is the only supported mode)
  const unknownKeys = Object.keys(input).filter(k => !(k in properties))
  if (unknownKeys.length > 0) {
    return { ok: false, error: `Unknown propert${unknownKeys.length === 1 ? 'y' : 'ies'}: ${unknownKeys.join(', ')}` }
  }

  // Check required fields
  for (const key of required) {
    if (!(key in input) || input[key] === undefined) {
      return { ok: false, error: `Missing required property: '${key}'` }
    }
  }

  // Validate each present property
  const value = {}
  for (const key of Object.keys(properties)) {
    if (!(key in input)) continue // absent optional — leave out of value
    const err = validateProperty(key, input[key], properties[key])
    if (err) return { ok: false, error: err }
    value[key] = input[key]
  }

  return { ok: true, value }
}
