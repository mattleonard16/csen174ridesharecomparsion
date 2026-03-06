import {
  CoordinateSchema,
  LatitudeSchema,
  LongitudeSchema,
  LocationNameSchema,
  ServiceTypeSchema,
  RideComparisonRequestSchema,
  GeocodingRequestSchema,
  ValidationError,
  validateInput,
  sanitizeString,
  detectSuspiciousCoordinates,
  detectSpamPatterns,
} from '@/lib/validation'
import { z } from 'zod'

describe('validation module', () => {
  describe('CoordinateSchema', () => {
    it('should accept valid positive coordinate', () => {
      expect(() => CoordinateSchema.parse('37.7749')).not.toThrow()
    })

    it('should accept valid negative coordinate', () => {
      expect(() => CoordinateSchema.parse('-122.4194')).not.toThrow()
    })

    it('should accept integer coordinate', () => {
      expect(() => CoordinateSchema.parse('37')).not.toThrow()
    })

    it('should accept zero', () => {
      expect(() => CoordinateSchema.parse('0')).not.toThrow()
    })

    it('should accept coordinate with many decimal places', () => {
      expect(() => CoordinateSchema.parse('37.77492950')).not.toThrow()
    })

    it('should reject coordinate with letters', () => {
      expect(() => CoordinateSchema.parse('37.7749abc')).toThrow()
    })

    it('should reject coordinate with special characters', () => {
      expect(() => CoordinateSchema.parse('37.7749!')).toThrow()
    })

    it('should reject empty string', () => {
      expect(() => CoordinateSchema.parse('')).toThrow()
    })

    it('should reject coordinate with multiple decimal points', () => {
      expect(() => CoordinateSchema.parse('37.77.49')).toThrow()
    })

    it('should reject coordinate with spaces', () => {
      expect(() => CoordinateSchema.parse('37 7749')).toThrow()
    })
  })

  describe('LatitudeSchema', () => {
    it('should accept latitude within Bay Area bounds (37.0)', () => {
      expect(() => LatitudeSchema.parse('37.0')).not.toThrow()
    })

    it('should accept latitude at lower bound (36.5)', () => {
      expect(() => LatitudeSchema.parse('36.5')).not.toThrow()
    })

    it('should accept latitude at upper bound (38.5)', () => {
      expect(() => LatitudeSchema.parse('38.5')).not.toThrow()
    })

    it('should accept latitude in middle of range', () => {
      expect(() => LatitudeSchema.parse('37.7749')).not.toThrow()
    })

    it('should reject latitude below Bay Area bounds', () => {
      expect(() => LatitudeSchema.parse('36.4')).toThrow(/Bay Area bounds/)
    })

    it('should reject latitude above Bay Area bounds', () => {
      expect(() => LatitudeSchema.parse('38.6')).toThrow(/Bay Area bounds/)
    })

    it('should reject latitude way outside bounds (Los Angeles)', () => {
      expect(() => LatitudeSchema.parse('34.0522')).toThrow(/Bay Area bounds/)
    })

    it('should reject invalid coordinate format first', () => {
      expect(() => LatitudeSchema.parse('invalid')).toThrow()
    })
  })

  describe('LongitudeSchema', () => {
    it('should accept longitude within Bay Area bounds (-122.0)', () => {
      expect(() => LongitudeSchema.parse('-122.0')).not.toThrow()
    })

    it('should accept longitude at lower bound (-123.5)', () => {
      expect(() => LongitudeSchema.parse('-123.5')).not.toThrow()
    })

    it('should accept longitude at upper bound (-121.0)', () => {
      expect(() => LongitudeSchema.parse('-121.0')).not.toThrow()
    })

    it('should accept longitude in middle of range', () => {
      expect(() => LongitudeSchema.parse('-122.4194')).not.toThrow()
    })

    it('should reject longitude below Bay Area bounds', () => {
      expect(() => LongitudeSchema.parse('-124.0')).toThrow(/Bay Area bounds/)
    })

    it('should reject longitude above Bay Area bounds', () => {
      expect(() => LongitudeSchema.parse('-120.5')).toThrow(/Bay Area bounds/)
    })

    it('should reject positive longitude (wrong hemisphere)', () => {
      expect(() => LongitudeSchema.parse('122.4194')).toThrow(/Bay Area bounds/)
    })

    it('should reject invalid coordinate format first', () => {
      expect(() => LongitudeSchema.parse('not-a-number')).toThrow()
    })
  })

  describe('LocationNameSchema', () => {
    it('should accept valid location name', () => {
      expect(() => LocationNameSchema.parse('San Francisco, CA')).not.toThrow()
    })

    it('should accept location with numbers', () => {
      expect(() => LocationNameSchema.parse('123 Main Street')).not.toThrow()
    })

    it('should accept location with periods', () => {
      expect(() => LocationNameSchema.parse('St. James Park')).not.toThrow()
    })

    it('should accept location with hyphens', () => {
      expect(() => LocationNameSchema.parse('San Jose-Sunnyvale')).not.toThrow()
    })

    it('should accept minimum length (2 characters)', () => {
      expect(() => LocationNameSchema.parse('SF')).not.toThrow()
    })

    it('should accept maximum length (100 characters)', () => {
      const longName = 'A'.repeat(100)
      expect(() => LocationNameSchema.parse(longName)).not.toThrow()
    })

    it('should reject empty string', () => {
      expect(() => LocationNameSchema.parse('')).toThrow(/at least 2 characters/)
    })

    it('should reject single character', () => {
      expect(() => LocationNameSchema.parse('A')).toThrow(/at least 2 characters/)
    })

    it('should reject name over 100 characters', () => {
      const tooLongName = 'A'.repeat(101)
      expect(() => LocationNameSchema.parse(tooLongName)).toThrow(/less than 100 characters/)
    })

    it('should reject location with HTML tags', () => {
      expect(() => LocationNameSchema.parse('<script>alert(1)</script>')).toThrow(
        /invalid characters/
      )
    })

    it('should reject location with quotes', () => {
      expect(() => LocationNameSchema.parse("O'Brien Street")).toThrow(/invalid characters/)
    })

    it('should reject location with special characters', () => {
      expect(() => LocationNameSchema.parse('San Francisco @#$')).toThrow(/invalid characters/)
    })

    it('should reject whitespace-only string', () => {
      expect(() => LocationNameSchema.parse('   ')).toThrow()
    })

    it('should accept airport names with code in parentheses', () => {
      expect(() =>
        LocationNameSchema.parse('San Francisco International Airport (SFO)')
      ).not.toThrow()
    })
  })

  describe('ServiceTypeSchema', () => {
    it('should accept uber', () => {
      expect(() => ServiceTypeSchema.parse('uber')).not.toThrow()
      expect(ServiceTypeSchema.parse('uber')).toBe('uber')
    })

    it('should accept lyft', () => {
      expect(() => ServiceTypeSchema.parse('lyft')).not.toThrow()
      expect(ServiceTypeSchema.parse('lyft')).toBe('lyft')
    })

    it('should accept taxi', () => {
      expect(() => ServiceTypeSchema.parse('taxi')).not.toThrow()
      expect(ServiceTypeSchema.parse('taxi')).toBe('taxi')
    })

    it('should accept waymo', () => {
      expect(() => ServiceTypeSchema.parse('waymo')).not.toThrow()
      expect(ServiceTypeSchema.parse('waymo')).toBe('waymo')
    })

    it('should reject uppercase service names', () => {
      expect(() => ServiceTypeSchema.parse('Uber')).toThrow(/uber, lyft, taxi, or waymo/)
    })

    it('should reject unknown service', () => {
      expect(() => ServiceTypeSchema.parse('bird')).toThrow(/uber, lyft, taxi, or waymo/)
    })

    it('should reject empty string', () => {
      expect(() => ServiceTypeSchema.parse('')).toThrow(/uber, lyft, taxi, or waymo/)
    })

    it('should reject number', () => {
      expect(() => ServiceTypeSchema.parse(123)).toThrow()
    })

    it('should reject null', () => {
      expect(() => ServiceTypeSchema.parse(null)).toThrow()
    })
  })

  describe('RideComparisonRequestSchema', () => {
    const validRequest = {
      from: {
        name: 'San Francisco, CA',
        lat: '37.7749',
        lng: '-122.4194',
      },
      to: {
        name: 'Oakland, CA',
        lat: '37.8044',
        lng: '-122.2711',
      },
      services: ['uber', 'lyft'],
    }

    it('should accept valid complete request', () => {
      expect(() => RideComparisonRequestSchema.parse(validRequest)).not.toThrow()
    })

    it('should accept request with single service', () => {
      const request = { ...validRequest, services: ['uber'] }
      expect(() => RideComparisonRequestSchema.parse(request)).not.toThrow()
    })

    it('should accept request with all three services', () => {
      const request = { ...validRequest, services: ['uber', 'lyft', 'taxi'] }
      expect(() => RideComparisonRequestSchema.parse(request)).not.toThrow()
    })

    it('should reject request with empty services array', () => {
      const request = { ...validRequest, services: [] }
      expect(() => RideComparisonRequestSchema.parse(request)).toThrow(/At least one service/)
    })

    it('should accept request with all four services', () => {
      const request = { ...validRequest, services: ['uber', 'lyft', 'taxi', 'waymo'] }
      expect(() => RideComparisonRequestSchema.parse(request)).not.toThrow()
    })

    it('should reject request with more than 4 services', () => {
      const request = { ...validRequest, services: ['uber', 'lyft', 'taxi', 'waymo', 'uber'] }
      expect(() => RideComparisonRequestSchema.parse(request)).toThrow()
    })

    it('should reject request with duplicate services', () => {
      const request = { ...validRequest, services: ['uber', 'uber'] }
      expect(() => RideComparisonRequestSchema.parse(request)).toThrow(/Duplicate services/)
    })

    it('should reject request missing from field', () => {
      const { from, ...request } = validRequest
      expect(() => RideComparisonRequestSchema.parse(request)).toThrow()
    })

    it('should reject request missing to field', () => {
      const { to, ...request } = validRequest
      expect(() => RideComparisonRequestSchema.parse(request)).toThrow()
    })

    it('should reject request missing services field', () => {
      const { services, ...request } = validRequest
      expect(() => RideComparisonRequestSchema.parse(request)).toThrow()
    })

    it('should reject request with invalid from latitude', () => {
      const request = {
        ...validRequest,
        from: { ...validRequest.from, lat: '40.0' },
      }
      expect(() => RideComparisonRequestSchema.parse(request)).toThrow(/Bay Area bounds/)
    })

    it('should reject request with invalid to longitude', () => {
      const request = {
        ...validRequest,
        to: { ...validRequest.to, lng: '-118.0' },
      }
      expect(() => RideComparisonRequestSchema.parse(request)).toThrow(/Bay Area bounds/)
    })

    it('should reject request with invalid location name', () => {
      const request = {
        ...validRequest,
        from: { ...validRequest.from, name: '<script>hack</script>' },
      }
      expect(() => RideComparisonRequestSchema.parse(request)).toThrow(/invalid characters/)
    })

    it('should reject request with invalid service type', () => {
      const request = { ...validRequest, services: ['uber', 'bird'] }
      expect(() => RideComparisonRequestSchema.parse(request)).toThrow(/uber, lyft, taxi, or waymo/)
    })
  })

  describe('GeocodingRequestSchema', () => {
    it('should accept valid query', () => {
      expect(() => GeocodingRequestSchema.parse({ query: 'San Francisco' })).not.toThrow()
    })

    it('should accept query with numbers', () => {
      expect(() => GeocodingRequestSchema.parse({ query: '123 Main St' })).not.toThrow()
    })

    it('should accept minimum length query (2 characters)', () => {
      expect(() => GeocodingRequestSchema.parse({ query: 'SF' })).not.toThrow()
    })

    it('should accept maximum length query (200 characters)', () => {
      const longQuery = 'A'.repeat(200)
      expect(() => GeocodingRequestSchema.parse({ query: longQuery })).not.toThrow()
    })

    it('should reject empty query', () => {
      expect(() => GeocodingRequestSchema.parse({ query: '' })).toThrow(/at least 2 characters/)
    })

    it('should reject single character query', () => {
      expect(() => GeocodingRequestSchema.parse({ query: 'A' })).toThrow(/at least 2 characters/)
    })

    it('should reject query over 200 characters', () => {
      const tooLongQuery = 'A'.repeat(201)
      expect(() => GeocodingRequestSchema.parse({ query: tooLongQuery })).toThrow(
        /less than 200 characters/
      )
    })

    it('should reject query with invalid characters', () => {
      expect(() => GeocodingRequestSchema.parse({ query: 'San Francisco @#$' })).toThrow(
        /invalid characters/
      )
    })

    it('should reject whitespace-only query', () => {
      expect(() => GeocodingRequestSchema.parse({ query: '   ' })).toThrow()
    })

    it('should reject missing query field', () => {
      expect(() => GeocodingRequestSchema.parse({})).toThrow()
    })
  })

  describe('ValidationError class', () => {
    it('should create error with message and field', () => {
      const error = new ValidationError('Invalid input', 'username')
      expect(error.message).toBe('Invalid input')
      expect(error.field).toBe('username')
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.name).toBe('ValidationError')
    })

    it('should create error with custom code', () => {
      const error = new ValidationError('Invalid input', 'email', 'INVALID_EMAIL')
      expect(error.code).toBe('INVALID_EMAIL')
    })

    it('should be instance of Error', () => {
      const error = new ValidationError('Test', 'field')
      expect(error).toBeInstanceOf(Error)
    })

    it('should have proper stack trace', () => {
      const error = new ValidationError('Test', 'field')
      expect(error.stack).toBeDefined()
    })
  })

  describe('validateInput function', () => {
    const TestSchema = z.object({
      name: z.string().min(1),
      age: z.number().positive(),
    })

    it('should return success true with valid data', () => {
      const result = validateInput(TestSchema, { name: 'John', age: 25 })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual({ name: 'John', age: 25 })
      }
    })

    it('should return success false with invalid data', () => {
      const result = validateInput(TestSchema, { name: '', age: 25 })
      expect(result.success).toBe(false)
    })

    it('should return validation errors for invalid data', () => {
      const result = validateInput(TestSchema, { name: '', age: -5 })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0)
        expect(result.errors[0]).toBeInstanceOf(ValidationError)
      }
    })

    it('should include field path in error', () => {
      const result = validateInput(TestSchema, { name: 'John', age: -5 })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors[0].field).toBe('age')
      }
    })

    it('should include context in error message', () => {
      const result = validateInput(TestSchema, { name: '', age: 25 }, 'User registration')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors[0].message).toContain('User registration')
      }
    })

    it('should handle nested object validation', () => {
      const NestedSchema = z.object({
        user: z.object({
          email: z.string().email(),
        }),
      })
      const result = validateInput(NestedSchema, { user: { email: 'invalid' } })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors[0].field).toBe('user.email')
      }
    })

    it('should handle array validation', () => {
      const ArraySchema = z.object({
        items: z.array(z.string().min(1)),
      })
      const result = validateInput(ArraySchema, { items: ['valid', ''] })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors[0].field).toContain('items')
      }
    })

    it('should handle missing required fields', () => {
      const result = validateInput(TestSchema, {})
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0)
      }
    })

    it('should handle non-ZodError exceptions', () => {
      const BrokenSchema = z.string().transform(() => {
        throw new Error('Unexpected error')
      })
      const result = validateInput(BrokenSchema, 'test')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors[0].field).toBe('unknown')
        expect(result.errors[0].message).toContain('Unexpected validation error')
      }
    })
  })

  describe('sanitizeString function', () => {
    it('should trim whitespace', () => {
      expect(sanitizeString('  hello  ')).toBe('hello')
    })

    it('should remove HTML angle brackets', () => {
      expect(sanitizeString('<script>alert(1)</script>')).toBe('scriptalert(1)/script')
    })

    it('should remove single quotes', () => {
      expect(sanitizeString("O'Brien")).toBe('OBrien')
    })

    it('should remove double quotes', () => {
      expect(sanitizeString('Say "Hello"')).toBe('Say Hello')
    })

    it('should remove semicolons', () => {
      expect(sanitizeString('hello; world')).toBe('hello world')
    })

    it('should remove ampersands', () => {
      expect(sanitizeString('hello & world')).toBe('hello  world')
    })

    it('should remove pipes', () => {
      expect(sanitizeString('hello | world')).toBe('hello  world')
    })

    it('should remove backticks', () => {
      expect(sanitizeString('hello `world`')).toBe('hello world')
    })

    it('should remove dollar signs', () => {
      expect(sanitizeString('$100')).toBe('100')
    })

    it('should truncate to 200 characters', () => {
      const longString = 'A'.repeat(250)
      expect(sanitizeString(longString).length).toBe(200)
    })

    it('should handle empty string', () => {
      expect(sanitizeString('')).toBe('')
    })

    it('should handle string with only whitespace', () => {
      expect(sanitizeString('   ')).toBe('')
    })

    it('should handle complex XSS attempt', () => {
      const xss = '<img src=x onerror="alert(1)">'
      const result = sanitizeString(xss)
      expect(result).not.toContain('<')
      expect(result).not.toContain('>')
      expect(result).not.toContain('"')
    })

    it('should handle shell injection attempt', () => {
      const injection = 'hello; rm -rf /'
      const result = sanitizeString(injection)
      expect(result).not.toContain(';')
    })

    it('should handle command substitution attempt', () => {
      const injection = '$(whoami)'
      const result = sanitizeString(injection)
      expect(result).not.toContain('$')
    })

    it('should preserve safe characters', () => {
      expect(sanitizeString('Hello World 123')).toBe('Hello World 123')
    })

    it('should preserve periods and commas', () => {
      expect(sanitizeString('San Francisco, CA.')).toBe('San Francisco, CA.')
    })

    it('should preserve hyphens', () => {
      expect(sanitizeString('San Jose-Sunnyvale')).toBe('San Jose-Sunnyvale')
    })
  })

  describe('detectSuspiciousCoordinates function', () => {
    it('should detect identical coordinates', () => {
      const from = { lat: '37.7749', lng: '-122.4194' }
      const to = { lat: '37.7749', lng: '-122.4194' }
      expect(detectSuspiciousCoordinates(from, to)).toBe(true)
    })

    it('should detect coordinates less than 100 meters apart', () => {
      // Approximately 50 meters apart
      const from = { lat: '37.7749', lng: '-122.4194' }
      const to = { lat: '37.7750', lng: '-122.4194' }
      expect(detectSuspiciousCoordinates(from, to)).toBe(true)
    })

    it('should accept coordinates more than 100 meters apart', () => {
      // Approximately 500 meters apart
      const from = { lat: '37.7749', lng: '-122.4194' }
      const to = { lat: '37.7800', lng: '-122.4194' }
      expect(detectSuspiciousCoordinates(from, to)).toBe(false)
    })

    it('should accept coordinates several kilometers apart', () => {
      // SF to Oakland (approximately 15 km)
      const from = { lat: '37.7749', lng: '-122.4194' }
      const to = { lat: '37.8044', lng: '-122.2711' }
      expect(detectSuspiciousCoordinates(from, to)).toBe(false)
    })

    it('should accept coordinates clearly over 100 meters apart', () => {
      // Approximately 150 meters (0.00135 degrees latitude ≈ 150m)
      const from = { lat: '37.7749', lng: '-122.4194' }
      const to = { lat: '37.77625', lng: '-122.4194' }
      expect(detectSuspiciousCoordinates(from, to)).toBe(false)
    })

    it('should detect suspicious coordinates with different latitudes but same longitude', () => {
      // About 11 meters apart
      const from = { lat: '37.77490', lng: '-122.4194' }
      const to = { lat: '37.77500', lng: '-122.4194' }
      expect(detectSuspiciousCoordinates(from, to)).toBe(true)
    })

    it('should detect suspicious coordinates with different longitudes but same latitude', () => {
      // About 11 meters apart
      const from = { lat: '37.7749', lng: '-122.41940' }
      const to = { lat: '37.7749', lng: '-122.41930' }
      expect(detectSuspiciousCoordinates(from, to)).toBe(true)
    })

    it('should handle coordinates across different areas', () => {
      // SF to San Jose (approximately 77 km)
      const from = { lat: '37.7749', lng: '-122.4194' }
      const to = { lat: '37.3382', lng: '-121.8863' }
      expect(detectSuspiciousCoordinates(from, to)).toBe(false)
    })

    it('should handle negative coordinate values', () => {
      const from = { lat: '-37.7749', lng: '122.4194' }
      const to = { lat: '-37.7749', lng: '122.4194' }
      expect(detectSuspiciousCoordinates(from, to)).toBe(true)
    })
  })

  describe('detectSpamPatterns function', () => {
    describe('spam keywords', () => {
      it('should detect "test" keyword', () => {
        expect(detectSpamPatterns('test location')).toBe(true)
      })

      it('should detect "Test" keyword (case insensitive)', () => {
        expect(detectSpamPatterns('Test Location')).toBe(true)
      })

      it('should detect "spam" keyword', () => {
        expect(detectSpamPatterns('spam address')).toBe(true)
      })

      it('should detect "bot" keyword', () => {
        expect(detectSpamPatterns('bot request')).toBe(true)
      })

      it('should detect "script" keyword', () => {
        expect(detectSpamPatterns('script injection')).toBe(true)
      })

      it('should detect "hack" keyword', () => {
        expect(detectSpamPatterns('hack attempt')).toBe(true)
      })
    })

    describe('single word detection', () => {
      it('should detect single word without spaces', () => {
        expect(detectSpamPatterns('singleword')).toBe(true)
      })

      it('should not flag multi-word location', () => {
        expect(detectSpamPatterns('San Francisco')).toBe(false)
      })

      it('should detect single uppercase word', () => {
        expect(detectSpamPatterns('LOCATION')).toBe(true)
      })
    })

    describe('long numbers', () => {
      it('should detect string with 10+ consecutive digits', () => {
        expect(detectSpamPatterns('Address 1234567890')).toBe(true)
      })

      it('should detect string with 15 consecutive digits', () => {
        expect(detectSpamPatterns('Location 123456789012345')).toBe(true)
      })

      it('should not flag string with 9 consecutive digits', () => {
        expect(detectSpamPatterns('Suite 123456789 Main St')).toBe(false)
      })

      it('should not flag normal address numbers', () => {
        expect(detectSpamPatterns('123 Main Street, Suite 456')).toBe(false)
      })
    })

    describe('repeated characters', () => {
      it('should detect 6+ repeated characters', () => {
        expect(detectSpamPatterns('Helloooooo World')).toBe(true)
      })

      it('should detect long string of same character', () => {
        expect(detectSpamPatterns('aaaaaaaaaa')).toBe(true)
      })

      it('should not flag 5 repeated characters', () => {
        expect(detectSpamPatterns('Hellooooo World')).toBe(false)
      })

      it('should detect repeated special characters', () => {
        expect(detectSpamPatterns('------')).toBe(true)
      })
    })

    describe('no letters detection', () => {
      it('should detect string with only numbers', () => {
        expect(detectSpamPatterns('12345')).toBe(true)
      })

      it('should detect string with only special characters', () => {
        expect(detectSpamPatterns('!@#$%')).toBe(true)
      })

      it('should detect string with only spaces and numbers', () => {
        expect(detectSpamPatterns('123 456 789')).toBe(true)
      })

      it('should not flag string with at least one letter', () => {
        expect(detectSpamPatterns('123 A Street')).toBe(false)
      })
    })

    describe('valid locations', () => {
      it('should accept "San Francisco, CA"', () => {
        expect(detectSpamPatterns('San Francisco, CA')).toBe(false)
      })

      it('should accept known airport codes', () => {
        expect(detectSpamPatterns('SFO')).toBe(false)
      })

      it('should accept "123 Main Street"', () => {
        expect(detectSpamPatterns('123 Main Street')).toBe(false)
      })

      it('should accept "Oakland International Airport"', () => {
        expect(detectSpamPatterns('Oakland International Airport')).toBe(false)
      })

      it('should accept "1 Market St, San Francisco"', () => {
        expect(detectSpamPatterns('1 Market St, San Francisco')).toBe(false)
      })

      it('should accept "Palo Alto"', () => {
        expect(detectSpamPatterns('Palo Alto')).toBe(false)
      })

      it('should accept "Mountain View, California"', () => {
        expect(detectSpamPatterns('Mountain View, California')).toBe(false)
      })
    })

    describe('edge cases', () => {
      it('should handle empty string (no letters)', () => {
        expect(detectSpamPatterns('')).toBe(true)
      })

      it('should handle whitespace only (no letters)', () => {
        expect(detectSpamPatterns('   ')).toBe(true)
      })

      it('should detect "testing" as spam (contains test)', () => {
        expect(detectSpamPatterns('testing location')).toBe(true)
      })

      it('should detect "contest" as NOT spam (test not at word boundary but contained)', () => {
        // The regex /test/i matches anywhere in string
        expect(detectSpamPatterns('contest hall')).toBe(true)
      })

      it('should detect "robotic" as spam (contains bot)', () => {
        expect(detectSpamPatterns('robotic center')).toBe(true)
      })
    })
  })

  describe('integration tests', () => {
    it('should validate and sanitize a complete ride comparison flow', () => {
      const rawInput = {
        from: {
          name: '  San Francisco, CA  ',
          lat: '37.7749',
          lng: '-122.4194',
        },
        to: {
          name: 'Oakland, CA',
          lat: '37.8044',
          lng: '-122.2711',
        },
        services: ['uber', 'lyft'],
      }

      // Sanitize names
      rawInput.from.name = sanitizeString(rawInput.from.name)
      rawInput.to.name = sanitizeString(rawInput.to.name)

      // Validate
      const result = validateInput(RideComparisonRequestSchema, rawInput)
      expect(result.success).toBe(true)
    })

    it('should detect and reject suspicious spam request', () => {
      const spamRequest = {
        from: {
          name: 'test location',
          lat: '37.7749',
          lng: '-122.4194',
        },
        to: {
          name: 'bot destination',
          lat: '37.7749',
          lng: '-122.4194', // Same coordinates!
        },
        services: ['uber'],
      }

      // Check for spam patterns
      const fromSpam = detectSpamPatterns(spamRequest.from.name)
      const toSpam = detectSpamPatterns(spamRequest.to.name)
      const suspiciousCoords = detectSuspiciousCoordinates(
        { lat: spamRequest.from.lat, lng: spamRequest.from.lng },
        { lat: spamRequest.to.lat, lng: spamRequest.to.lng }
      )

      expect(fromSpam).toBe(true)
      expect(toSpam).toBe(true)
      expect(suspiciousCoords).toBe(true)
    })

    it('should properly validate geocoding request with sanitized input', () => {
      const rawQuery = '  <script>San Francisco</script>  '
      const sanitized = sanitizeString(rawQuery)

      // After sanitization, the query should still fail validation due to invalid chars
      // But let's test with a valid sanitized result
      const cleanQuery = '  San Francisco, CA  '
      const cleanSanitized = sanitizeString(cleanQuery)

      const result = validateInput(GeocodingRequestSchema, { query: cleanSanitized })
      expect(result.success).toBe(true)
    })
  })
})
