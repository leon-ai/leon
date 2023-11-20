import {
  WidgetWrapper,
  Card,
  Text,
  Button
} from '../../../../../../aurora/dist/aurora.js'

export default function () {
  return (
    <WidgetWrapper>
      <Card>
        <Button>Click me primary</Button>
        <Button secondary>Click me secondary</Button>
        <Button danger iconName="delete-bin" disabled>
          Click me primary danger
        </Button>
      </Card>
      <Card>
        <Text fontSize="xl">XL</Text>
        <Text fontSize="xs">Hello world</Text>
      </Card>
    </WidgetWrapper>
  )
}
