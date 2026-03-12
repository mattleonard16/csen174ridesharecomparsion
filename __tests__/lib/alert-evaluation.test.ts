import { $Enums } from '@/lib/generated/prisma'
import { logError } from '@/lib/monitoring'
import { prisma } from '@/lib/prisma'
import {
  evaluateAndCreateNotifications,
  matchesAlertService,
  parsePriceString,
  priceTriggers,
} from '@/lib/alert-evaluation'
import { isDatabaseAvailable } from '@/lib/database-logging'
import type { ComparisonResults } from '@/types'

jest.mock('@/lib/database-logging', () => ({
  isDatabaseAvailable: jest.fn(),
}))

jest.mock('@/lib/monitoring', () => ({
  logError: jest.fn(),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    priceAlert: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    alertNotification: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}))

const mockIsDatabaseAvailable = isDatabaseAvailable as jest.MockedFunction<
  typeof isDatabaseAvailable
>
const mockLogError = logError as jest.MockedFunction<typeof logError>

describe('alert evaluation helpers', () => {
  it('parses formatted price strings', () => {
    expect(parsePriceString('$24.50')).toBe(24.5)
    expect(parsePriceString('$0.00')).toBe(0)
    expect(parsePriceString('')).toBeNull()
    expect(parsePriceString('free')).toBeNull()
  })

  it('evaluates BELOW and ABOVE thresholds correctly', () => {
    expect(priceTriggers($Enums.AlertType.BELOW, 19, 20)).toBe(true)
    expect(priceTriggers($Enums.AlertType.BELOW, 20, 20)).toBe(false)
    expect(priceTriggers($Enums.AlertType.ABOVE, 21, 20)).toBe(true)
    expect(priceTriggers($Enums.AlertType.ABOVE, 20, 20)).toBe(false)
  })

  it('matches service filters including ANY', () => {
    expect(matchesAlertService($Enums.ServiceType.ANY, 'uber')).toBe(true)
    expect(matchesAlertService($Enums.ServiceType.UBER, 'uber')).toBe(true)
    expect(matchesAlertService($Enums.ServiceType.UBER, 'lyft')).toBe(false)
  })
})

describe('evaluateAndCreateNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDatabaseAvailable.mockReturnValue(true)
    ;(prisma.priceAlert.findMany as jest.Mock).mockResolvedValue([])
    ;(prisma.alertNotification.create as jest.Mock).mockImplementation(({ data }) =>
      Promise.resolve({ id: 'notification-1', ...data })
    )
    ;(prisma.priceAlert.update as jest.Mock).mockImplementation(({ where, data }) =>
      Promise.resolve({ id: where.id, ...data })
    )
    ;(prisma.$transaction as jest.Mock).mockImplementation(async operations => Promise.all(operations))
  })

  it('returns early when the database is unavailable', async () => {
    mockIsDatabaseAvailable.mockReturnValue(false)

    await expect(
      evaluateAndCreateNotifications('route-1', 'user-1', {
        uber: {
          price: '$19.50',
          waitTime: '4 min',
          driversNearby: 5,
          service: 'UberX',
        },
      })
    ).resolves.toBeUndefined()

    expect(prisma.priceAlert.findMany).not.toHaveBeenCalled()
  })

  it('creates a notification when a price crosses the alert threshold', async () => {
    ;(prisma.priceAlert.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'alert-1',
        userId: 'user-1',
        service: $Enums.ServiceType.UBER,
        alertType: $Enums.AlertType.BELOW,
        targetPrice: 20,
        savedRoute: { routeId: 'route-1' },
      },
    ])

    await evaluateAndCreateNotifications('route-1', 'user-1', {
      uber: {
        price: '$19.50',
        waitTime: '4 min',
        driversNearby: 5,
        service: 'UberX',
      },
    })

    expect(prisma.alertNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        alertId: 'alert-1',
        userId: 'user-1',
        routeId: 'route-1',
        service: $Enums.ServiceType.UBER,
        triggeredPrice: 19.5,
        targetPrice: 20,
      }),
    })
    expect(prisma.priceAlert.update).toHaveBeenCalledWith({
      where: { id: 'alert-1' },
      data: expect.objectContaining({
        triggerCount: { increment: 1 },
        lastTriggeredAt: expect.any(Date),
      }),
    })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('does not create notifications when prices do not trigger', async () => {
    ;(prisma.priceAlert.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'alert-2',
        userId: 'user-1',
        service: $Enums.ServiceType.UBER,
        alertType: $Enums.AlertType.BELOW,
        targetPrice: 20,
        savedRoute: { routeId: 'route-1' },
      },
    ])

    await evaluateAndCreateNotifications('route-1', 'user-1', {
      uber: {
        price: '$20.00',
        waitTime: '4 min',
        driversNearby: 5,
        service: 'UberX',
      },
    })

    expect(prisma.alertNotification.create).not.toHaveBeenCalled()
    expect(prisma.priceAlert.update).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('matches ANY alerts across multiple result services', async () => {
    const results: ComparisonResults = {
      uber: {
        price: '$18.00',
        waitTime: '4 min',
        driversNearby: 5,
        service: 'UberX',
      },
      lyft: {
        price: '$19.25',
        waitTime: '5 min',
        driversNearby: 4,
        service: 'Lyft Standard',
      },
    }
    ;(prisma.priceAlert.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'alert-any',
        userId: 'user-1',
        service: $Enums.ServiceType.ANY,
        alertType: $Enums.AlertType.BELOW,
        targetPrice: 20,
        savedRoute: { routeId: 'route-1' },
      },
    ])

    await evaluateAndCreateNotifications('route-1', 'user-1', results)

    expect(prisma.alertNotification.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          service: $Enums.ServiceType.UBER,
          triggeredPrice: 18,
        }),
      })
    )
    expect(prisma.alertNotification.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          service: $Enums.ServiceType.LYFT,
          triggeredPrice: 19.25,
        }),
      })
    )
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
  })

  it('catches prisma errors without throwing', async () => {
    ;(prisma.priceAlert.findMany as jest.Mock).mockRejectedValue(new Error('db failed'))

    await expect(
      evaluateAndCreateNotifications('route-1', 'user-1', {
        uber: {
          price: '$18.00',
          waitTime: '4 min',
          driversNearby: 5,
          service: 'UberX',
        },
      })
    ).resolves.toBeUndefined()

    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(Error),
        route: 'lib/alert-evaluation.evaluateAndCreateNotifications',
        routeId: 'route-1',
        userId: 'user-1',
      })
    )
  })
})
