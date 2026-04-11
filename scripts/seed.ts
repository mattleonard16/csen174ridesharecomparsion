/**
 * Seed script for local development
 * Populates routes, saved routes, price snapshots, and route insights
 * for popular Bay Area routes across all ride services.
 */

import { prisma } from '../lib/prisma'
import { $Enums } from '../lib/generated/prisma'
import { createHash } from 'crypto'
import { encodeRouteGeohash } from '../lib/geo'

const ServiceTypeEnum = $Enums.ServiceType
const TrafficLevelEnum = $Enums.TrafficLevel

function generateRouteHash(
  pickupLat: number,
  pickupLng: number,
  destLat: number,
  destLng: number
): string {
  const hash = createHash('sha256')
  hash.update(`${pickupLat},${pickupLng},${destLat},${destLng}`)
  return hash.digest('hex').substring(0, 16)
}

const POPULAR_ROUTES = [
  {
    pickup_address: 'San Francisco International Airport (SFO), San Francisco, CA, USA',
    pickup_lat: 37.6164922,
    pickup_lng: -122.3904569,
    destination_address: 'Downtown San Francisco, San Francisco, CA, USA',
    destination_lat: 37.7898562,
    destination_lng: -122.4195684,
    distance_miles: 13.4,
    duration_minutes: 23,
  },
  {
    pickup_address: 'Stanford University, Stanford, CA, USA',
    pickup_lat: 37.4275,
    pickup_lng: -122.1697,
    destination_address: 'Apple Park, Cupertino, CA, USA',
    destination_lat: 37.3349,
    destination_lng: -122.009,
    distance_miles: 8.0,
    duration_minutes: 18,
  },
  {
    pickup_address: 'San Jose International Airport (SJC), San Jose, CA, USA',
    pickup_lat: 37.3639,
    pickup_lng: -121.9289,
    destination_address: 'Santa Clara, CA, USA',
    destination_lat: 37.3541,
    destination_lng: -121.9552,
    distance_miles: 2.0,
    duration_minutes: 8,
  },
  {
    pickup_address: 'Palo Alto, CA, USA',
    pickup_lat: 37.4419,
    pickup_lng: -122.143,
    destination_address: 'Googleplex, Mountain View, CA, USA',
    destination_lat: 37.422,
    destination_lng: -122.0841,
    distance_miles: 4.0,
    duration_minutes: 12,
  },
  {
    pickup_address: 'Oakland International Airport (OAK), Oakland, CA, USA',
    pickup_lat: 37.7126,
    pickup_lng: -122.2197,
    destination_address: 'Downtown Oakland, Oakland, CA, USA',
    destination_lat: 37.8044,
    destination_lng: -122.2711,
    distance_miles: 9.0,
    duration_minutes: 18,
  },
  {
    pickup_address: 'San Francisco International Airport (SFO), San Francisco, CA, USA',
    pickup_lat: 37.6164922,
    pickup_lng: -122.3904569,
    destination_address: 'Palo Alto, CA, USA',
    destination_lat: 37.4419,
    destination_lng: -122.143,
    distance_miles: 20.2,
    duration_minutes: 35,
  },
]

const SERVICE_PRICING: Record<string, { baseFare: number; perMile: number; perMin: number }> = {
  UBER: { baseFare: 2.5, perMile: 1.75, perMin: 0.35 },
  LYFT: { baseFare: 2.0, perMile: 1.65, perMin: 0.3 },
  TAXI: { baseFare: 3.5, perMile: 2.5, perMin: 0.55 },
  WAYMO: { baseFare: 3.0, perMile: 1.5, perMin: 0.25 },
}

const WEATHER_CONDITIONS = ['Clear', 'Cloudy', 'Fog', 'Overcast']

function getBasePrice(service: string, distMiles: number, durMin: number): number {
  const pricing = SERVICE_PRICING[service]
  return pricing.baseFare + pricing.perMile * distMiles + pricing.perMin * durMin
}

function getSurgeMultiplier(hour: number, dayOfWeek: number, isRaining: boolean): number {
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
  const isMorningRush = hour >= 7 && hour <= 9
  const isEveningRush = hour >= 17 && hour <= 19
  const isLateNight = hour >= 22 || hour <= 4

  let surge = 1.0
  if (isMorningRush && !isWeekend) surge = 1.3 + Math.random() * 0.5
  else if (isEveningRush && !isWeekend) surge = 1.4 + Math.random() * 0.6
  else if (isLateNight) surge = 1.2 + Math.random() * 0.4
  else if (isWeekend && hour >= 10 && hour <= 14) surge = 1.1 + Math.random() * 0.2
  else surge = 1.0 + Math.random() * 0.15

  if (isRaining) surge += 0.2 + Math.random() * 0.3
  return Math.round(surge * 100) / 100
}

function getTrafficLevel(hour: number, dayOfWeek: number): $Enums.TrafficLevel {
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
  if (isWeekend) return TrafficLevelEnum.LIGHT
  if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) return TrafficLevelEnum.HEAVY
  if (hour >= 10 && hour <= 16) return TrafficLevelEnum.MODERATE
  return TrafficLevelEnum.LIGHT
}

async function main() {
  console.log('Starting seed...\n')

  // Find user
  const user = await prisma.user.findFirst({
    where: { email: 'mleonard1616@gmail.com' },
    select: { id: true, email: true },
  })
  if (!user) {
    console.error('No user found.')
    process.exit(1)
  }
  console.log(`User: ${user.email}\n`)

  // Clean existing snapshots
  const deleted = await prisma.priceSnapshot.deleteMany({})
  console.log(`Cleared ${deleted.count} existing snapshots`)

  // Step 1: Upsert routes
  console.log('\nSeeding routes...')
  const routeIds: string[] = []

  for (const route of POPULAR_ROUTES) {
    const routeHash = generateRouteHash(
      route.pickup_lat, route.pickup_lng,
      route.destination_lat, route.destination_lng
    )
    const created = await prisma.route.upsert({
      where: { route_hash: routeHash },
      update: {},
      create: {
        pickup_address: route.pickup_address,
        pickup_lat: route.pickup_lat,
        pickup_lng: route.pickup_lng,
        destination_address: route.destination_address,
        destination_lat: route.destination_lat,
        destination_lng: route.destination_lng,
        distance_miles: route.distance_miles,
        duration_minutes: route.duration_minutes,
        route_hash: routeHash,
        pickup_geohash: encodeRouteGeohash(route.pickup_lng, route.pickup_lat),
        destination_geohash: encodeRouteGeohash(route.destination_lng, route.destination_lat),
      },
    })
    routeIds.push(created.id)
    console.log(`  ${route.pickup_address.split(',')[0]} -> ${route.destination_address.split(',')[0]}`)
  }

  // Step 2: Create saved routes (delete existing first to avoid constraint issues)
  console.log('\nSeeding saved routes...')
  await prisma.savedRoute.deleteMany({ where: { userId: user.id } })

  for (let i = 0; i < routeIds.length; i++) {
    const route = POPULAR_ROUTES[i]
    await prisma.savedRoute.create({
      data: {
        userId: user.id,
        routeId: routeIds[i],
        fromName: route.pickup_address.split(',')[0],
        toName: route.destination_address.split(',')[0],
        fromLat: route.pickup_lat,
        fromLng: route.pickup_lng,
        toLat: route.destination_lat,
        toLng: route.destination_lng,
      },
    })
    console.log(`  ${route.pickup_address.split(',')[0]} -> ${route.destination_address.split(',')[0]}`)
  }

  // Step 3: Create price snapshots in batches
  console.log('\nSeeding price snapshots (30 days)...')
  const services = [ServiceTypeEnum.UBER, ServiceTypeEnum.LYFT, ServiceTypeEnum.TAXI, ServiceTypeEnum.WAYMO]
  const now = new Date()

  for (let i = 0; i < routeIds.length; i++) {
    const routeId = routeIds[i]
    const route = POPULAR_ROUTES[i]
    const batch: any[] = []

    for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
      for (let hour = 0; hour < 24; hour += 2) {
        const timestamp = new Date(now)
        timestamp.setDate(timestamp.getDate() - dayOffset)
        timestamp.setHours(hour, Math.floor(Math.random() * 30), 0, 0)

        const dayOfWeek = timestamp.getDay()
        const isRaining = Math.random() > 0.82
        const weatherCondition = isRaining
          ? 'Rain'
          : WEATHER_CONDITIONS[Math.floor(Math.random() * WEATHER_CONDITIONS.length)]
        const weatherTempF = 48 + Math.floor(Math.random() * 30)

        for (const service of services) {
          const basePrice = getBasePrice(service, route.distance_miles, route.duration_minutes)
          const surgeMultiplier = getSurgeMultiplier(hour, dayOfWeek, isRaining)
          const jitter = 0.95 + Math.random() * 0.1
          const finalPrice = Math.round(basePrice * surgeMultiplier * jitter * 100) / 100

          batch.push({
            routeId,
            service,
            base_price: Math.round(basePrice * 100) / 100,
            surge_multiplier: surgeMultiplier,
            final_price: finalPrice,
            wait_time_minutes: Math.floor(2 + Math.random() * 10),
            day_of_week: dayOfWeek,
            hour_of_day: hour,
            weather_condition: weatherCondition,
            weather_temp_f: weatherTempF,
            is_raining: isRaining,
            traffic_level: getTrafficLevel(hour, dayOfWeek),
            nearby_events: [],
            confidence: Math.round((0.7 + Math.random() * 0.2) * 100) / 100,
            createdAt: timestamp,
          })
        }
      }
    }

    const result = await prisma.priceSnapshot.createMany({ data: batch })
    console.log(`  ${route.pickup_address.split(',')[0]} -> ${route.destination_address.split(',')[0]}: ${result.count} snapshots`)
  }

  // Step 4: Create route insights
  console.log('\nSeeding route insights...')
  for (let i = 0; i < routeIds.length; i++) {
    const routeId = routeIds[i]
    const route = POPULAR_ROUTES[i]

    for (const service of services) {
      const basePrice = getBasePrice(service, route.distance_miles, route.duration_minutes)

      const avgPriceByHour: Record<string, number> = {}
      const surgeProbabilityByHour: Record<string, number> = {}

      for (let h = 0; h < 24; h++) {
        let avgSurge = 1.05
        let surgeProb = 0.1
        if (h >= 7 && h <= 9) { avgSurge = 1.5; surgeProb = 0.75 }
        else if (h >= 17 && h <= 19) { avgSurge = 1.6; surgeProb = 0.85 }
        else if (h >= 22 || h <= 4) { avgSurge = 1.3; surgeProb = 0.4 }

        avgPriceByHour[String(h)] = Math.round(basePrice * avgSurge * 100) / 100
        surgeProbabilityByHour[String(h)] = surgeProb
      }

      await prisma.routeInsights.upsert({
        where: { routeId_service: { routeId, service } },
        update: { avgPriceByHour, surgeProbabilityByHour, sampleSize: 360, lastUpdated: new Date() },
        create: {
          routeId,
          service,
          cheapestHour: 14,
          cheapestAvgPrice: avgPriceByHour['14'],
          expensiveHour: 18,
          expensiveAvgPrice: avgPriceByHour['18'],
          avgPriceByHour,
          surgeProbabilityByHour,
          sampleSize: 360,
        },
      })
    }
    console.log(`  ${route.pickup_address.split(',')[0]} -> ${route.destination_address.split(',')[0]}`)
  }

  console.log('\nSeed completed!')
  await prisma.$disconnect()
}

main().catch(e => {
  console.error('Seed failed:', e)
  process.exit(1)
})
