import { Input as AuroraInput, type InputProps as AuroraInputProps } from '../../../../../aurora/src/v2/components/input/input'
import { Icon } from '@/components/icon'

type InputProps = AuroraInputProps & {
  iconName?: string
  iconType?: 'line' | 'fill'
}

/**
 * Supplies the web app's local icon registry to Aurora's shared native field.
 */
export function Input({ iconName, iconType = 'line', ...props }: InputProps) {
  return <AuroraInput {...props} icon={iconName === undefined ? props.icon : <Icon name={`${iconName}-${iconType}`} />} />
}
