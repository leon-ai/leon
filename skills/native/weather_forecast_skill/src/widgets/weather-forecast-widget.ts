import type { WidgetComponent } from '@sdk/widget-component'
import { Widget, type WidgetOptions } from '@sdk/widget'
import { Flexbox } from '@sdk/aurora/flexbox'
import { Icon } from '@sdk/aurora/icon'
import { Text } from '@sdk/aurora/text'

interface Params {
  location: string
  description: string
  temperature: string
  feelsLike: string
  humidity: string
  wind: string
  observationTime?: string
}

export class WeatherForecastWidget extends Widget<Params> {
  constructor(options: WidgetOptions<Params>) {
    super(options)
  }

  public render(): WidgetComponent {
    const {
      location,
      description,
      temperature,
      feelsLike,
      humidity,
      wind,
      observationTime
    } = this.params

    return new Flexbox({
      flexDirection: 'column',
      gap: 'lg',
      children: [
        new Flexbox({
          flexDirection: 'column',
          gap: 'xs',
          children: [
            new Flexbox({
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              children: [
                new Flexbox({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 'sm',
                  children: [
                    new Icon({
                      iconName: 'map-pin',
                      size: 'md',
                      color: 'blue'
                    }),
                    new Text({
                      fontSize: 'lg',
                      fontWeight: 'semi-bold',
                      children: location
                    })
                  ]
                })
              ]
            }),
            ...(description
              ? [
                  new Text({
                    secondary: true,
                    children: description
                  })
                ]
              : [])
          ]
        }),
        new Flexbox({
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 'md',
          children: [
            new Icon({
              iconName: this.getWeatherIcon(description),
              size: 'xxl',
              color: 'blue'
            }),
            new Text({
              fontSize: 'xl',
              fontWeight: 'semi-bold',
              children: temperature
            })
          ]
        }),
        new Flexbox({
          flexDirection: 'row',
          justifyContent: 'space-around',
          gap: 'md',
          children: [
            new Flexbox({
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'xs',
              children: [
                new Icon({
                  iconName: 'temp-hot',
                  size: 'md',
                  color: 'secondary-blue'
                }),
                new Text({
                  fontSize: 'sm',
                  secondary: true,
                  children: this.content('feels_like_label')
                }),
                new Text({
                  fontWeight: 'semi-bold',
                  children: feelsLike
                })
              ]
            }),
            new Flexbox({
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'xs',
              children: [
                new Icon({
                  iconName: 'drop',
                  size: 'md',
                  color: 'secondary-blue'
                }),
                new Text({
                  fontSize: 'sm',
                  secondary: true,
                  children: this.content('humidity_label')
                }),
                new Text({
                  fontWeight: 'semi-bold',
                  children: humidity
                })
              ]
            }),
            new Flexbox({
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'xs',
              children: [
                new Icon({
                  iconName: 'windy',
                  size: 'md',
                  color: 'secondary-blue'
                }),
                new Text({
                  fontSize: 'sm',
                  secondary: true,
                  children: this.content('wind_label')
                }),
                new Text({
                  fontWeight: 'semi-bold',
                  children: wind
                })
              ]
            })
          ]
        }),
        ...(observationTime
          ? [
              new Flexbox({
                flexDirection: 'row',
                justifyContent: 'center',
                children: [
                  new Text({
                    fontSize: 'sm',
                    secondary: true,
                    children: this.content('observed_at', {
                      value: observationTime
                    })
                  })
                ]
              })
            ]
          : [])
      ]
    })
  }

  private getWeatherIcon(description: string): string {
    const desc = description.toLowerCase()
    const iconMap: Array<{ keywords: string[], icon: string }> = [
      { keywords: ['clear', 'sunny'], icon: 'sun' },
      { keywords: ['cloud', 'overcast'], icon: 'cloud' },
      { keywords: ['drizzle'], icon: 'drizzle' },
      { keywords: ['shower'], icon: 'heavy-showers' },
      { keywords: ['rain'], icon: 'rainy' },
      { keywords: ['snow'], icon: 'snowy' },
      { keywords: ['thunder', 'storm'], icon: 'thunderstorms' },
      { keywords: ['fog', 'mist'], icon: 'foggy' },
      { keywords: ['wind'], icon: 'windy' }
    ]

    for (const { keywords, icon } of iconMap) {
      if (keywords.some((keyword) => desc.includes(keyword))) {
        return icon
      }
    }

    return 'sun-cloudy'
  }
}
