import {
  WidgetWrapper,
  Card,
  Text,
  Button,
  Checkbox,
  Loader,
  Flexbox,
  Status
} from '@leon-ai/aurora'

// TODO: be able to parse comments; props interpolation checked={false}; etc.

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
      <Card>
        <Status color="green">ok</Status>
        <Status>ok</Status>
        <Text fontSize="xl">XL</Text>
      </Card>
      <Checkbox label="Checkbox" checked={false} value="test" />
    </WidgetWrapper>
  )
}
