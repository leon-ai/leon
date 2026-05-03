import type { WidgetComponent } from '@sdk/widget-component'
import { Widget, type WidgetOptions } from '@sdk/widget'
import { Card } from '@sdk/aurora/card'
import { CircularProgress } from '@sdk/aurora/circular-progress'
import { Text } from '@sdk/aurora/text'
import { Flexbox } from '@sdk/aurora/flexbox'

interface Params {
  videoUrl: string
  targetLanguage: string
  quality: string
  percentage: number
  status: string
  speed: string
  eta: string
  size: string
}

export class DownloadProgressWidget extends Widget<Params> {
  constructor(options: WidgetOptions<Params>) {
    super(options)
  }

  public render(): WidgetComponent {
    const { targetLanguage, quality, percentage, status, speed, eta, size } =
      this.params

    return new Card({
      children: [
        new Flexbox({
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'md',
          children: [
            // Header text
            new Text({
              fontSize: 'lg',
              fontWeight: 'semi-bold',
              children: `Downloading video for ${targetLanguage} translation`
            }),

            // Progress circle with percentage
            new CircularProgress({
              value: Math.round(percentage),
              size: 'lg',
              children: `${Math.round(percentage)}%`
            }),

            // Status and details
            new Flexbox({
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'sm',
              children: [
                new Text({
                  children: `Status: ${status}`
                }),
                ...(speed
                  ? [
                      new Text({
                        children: `Speed: ${speed}`
                      })
                    ]
                  : []),
                ...(eta
                  ? [
                      new Text({
                        children: `ETA: ${eta}`
                      })
                    ]
                  : []),
                ...(size
                  ? [
                      new Text({
                        children: `Size: ${size}`
                      })
                    ]
                  : []),
                new Text({
                  fontSize: 'sm',
                  secondary: true,
                  children: `Quality: ${quality}`
                })
              ]
            })
          ]
        })
      ]
    })
  }
}
