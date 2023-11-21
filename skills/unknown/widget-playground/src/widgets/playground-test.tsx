import {
  WidgetWrapper,
  Card,
  Text,
  Button,
  Checkbox
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
      <Card>
        <Checkbox
          label="This is a checkbox"
          checked={false}
          value="test"
          onChange={(e) => console.log('Checkbox state:', e)}
        />
      </Card>
    </WidgetWrapper>
  )
}
