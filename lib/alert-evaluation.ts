import { $Enums, type AlertType, type ServiceType } from '@/lib/generated/prisma'
import { isDatabaseAvailable } from '@/lib/database-logging'
import { logError } from '@/lib/monitoring'
import { prisma } from '@/lib/prisma'
import { isRideServiceName, mapServiceToEnumWithAny } from '@/lib/service-mappings'
import type { ComparisonResults } from '@/types'

export function parsePriceString(price: string): number | null {
  const numericPrice = Number.parseFloat(price.replace(/\$/g, '').trim())
  return Number.isNaN(numericPrice) ? null : numericPrice
}

export function priceTriggers(alertType: AlertType, actual: number, target: number): boolean {
  if (alertType === $Enums.AlertType.ABOVE) {
    return actual > target
  }

  return actual < target
}

export function matchesAlertService(alertService: ServiceType, resultService: string): boolean {
  if (alertService === $Enums.ServiceType.ANY) {
    return true
  }

  return alertService.toLowerCase() === resultService.toLowerCase()
}

export async function evaluateAndCreateNotifications(
  routeId: string,
  userId: string,
  results: ComparisonResults
): Promise<void> {
  if (!isDatabaseAvailable()) {
    return
  }

  try {
    const alerts = await prisma.priceAlert.findMany({
      where: {
        isActive: true,
        userId,
        savedRoute: {
          routeId,
        },
      },
      include: {
        savedRoute: true,
      },
    })

    for (const alert of alerts) {
      for (const [serviceKey, result] of Object.entries(results)) {
        if (!result || !matchesAlertService(alert.service, serviceKey)) {
          continue
        }

        if (!isRideServiceName(serviceKey)) {
          continue
        }

        const parsedPrice = parsePriceString(result.price)
        if (
          parsedPrice === null ||
          !priceTriggers(alert.alertType, parsedPrice, alert.targetPrice)
        ) {
          continue
        }

        await prisma.$transaction([
          prisma.alertNotification.create({
            data: {
              alertId: alert.id,
              userId,
              routeId,
              service:
                alert.service === $Enums.ServiceType.ANY
                  ? mapServiceToEnumWithAny(serviceKey)
                  : alert.service,
              triggeredPrice: parsedPrice,
              targetPrice: alert.targetPrice,
            },
          }),
          prisma.priceAlert.update({
            where: { id: alert.id },
            data: {
              lastTriggeredAt: new Date(),
              triggerCount: {
                increment: 1,
              },
            },
          }),
        ])
      }
    }
  } catch (error) {
    logError({
      error: error instanceof Error ? error : new Error('Failed to evaluate price alerts'),
      route: 'lib/alert-evaluation.evaluateAndCreateNotifications',
      routeId,
      userId,
    })
  }
}
