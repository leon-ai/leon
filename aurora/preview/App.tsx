import { useState, useEffect } from 'react'

import {
  Button,
  Card,
  Checkbox,
  CircularProgress,
  Flexbox,
  Form,
  Icon,
  IconButton,
  Image,
  Input,
  Link,
  List,
  ListHeader,
  ListItem,
  Loader,
  Progress,
  Radio,
  RadioGroup,
  RangeSlider,
  ScrollContainer,
  Select,
  SelectOption,
  Status,
  Switch,
  Tab,
  TabContent,
  TabGroup,
  TabList,
  Text,
  WidgetWrapper
} from '../src'

interface SectionProps extends React.PropsWithChildren {
  title: string
}

const Section: React.FC<SectionProps> = (props) => {
  const { title, children } = props

  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  const formattedMinutes = minutes < 10 ? `0${minutes}` : minutes
  const formattedSeconds =
    remainingSeconds < 10 ? `0${remainingSeconds}` : remainingSeconds

  return `${formattedMinutes}:${formattedSeconds}`
}

function Timer({
  value,
  initialTime,
  interval
}: {
  value: number
  initialTime: number
  interval: number
}) {
  const [progress, setProgress] = useState(0)
  const [timeLeft, setTimeLeft] = useState(initialTime)

  useEffect(() => {
    setTimeLeft(initialTime)
    setProgress(0)
  }, [initialTime, value])

  useEffect(() => {
    if (timeLeft === 0) {
      return
    }

    const timer = setInterval(() => {
      setTimeLeft((prevTime) => prevTime - 1)
      setProgress((prevProgress) => prevProgress + 100 / initialTime)
    }, interval)

    return () => clearInterval(timer)
  }, [initialTime, interval, timeLeft])

  return (
    <CircularProgress value={progress} size="lg">
      <Flexbox gap="xs" alignItems="center" justifyContent="center">
        <Text fontSize="lg" fontWeight="semi-bold">
          {formatTime(timeLeft)}
        </Text>
        <Text fontSize="xs" secondary>
          Total 10 minutes
        </Text>
      </Flexbox>
    </CircularProgress>
  )
}

export const App: React.FC = () => {
  const [isSending, setIsSending] = useState(false)
  const [isSendingIconButton, setIsSendingIconButton] = useState(false)
  const [isPlayButtonActivated, setIsPlayButtonActivated] = useState(false)
  const [isPlayButton2Activated, setIsPlayButton2Activated] = useState(false)

  return (
    <>
      <Section title="Button">
        <Flexbox flexDirection="row" gap="xl">
          <WidgetWrapper>
            <Flexbox gap="md">
              <Button onClick={() => console.log('button clicked')}>
                Continue
              </Button>
              <Button
                iconName="send-plane"
                loading={isSending}
                onClick={() => {
                  setIsSending(true)

                  setTimeout(() => {
                    setIsSending(false)
                  }, 2_000)
                }}
              >
                Send
              </Button>
              <Button iconName="arrow-right" iconPosition="right">
                Next step
              </Button>
              <Button disabled>Disabled</Button>
              <Button secondary iconName="heart">
                Secondary button
              </Button>
              <Button secondary disabled>
                Disabled
              </Button>
              <Button loading>Loading</Button>
              <Button danger>Danger</Button>
              <Button danger disabled iconName="delete-bin">
                Disabled
              </Button>
              <Button light>Light button</Button>
              <Button light iconName="arrow-right" iconPosition="right">
                Next
              </Button>
              <Button light disabled>
                Disabled
              </Button>
            </Flexbox>
          </WidgetWrapper>
          <WidgetWrapper>
            <Flexbox gap="md">
              <Input name="input-1" placeholder="Input 1" />
              <Input name="input-2" placeholder="Input 2" />
              <Flexbox gap="md">
                <Button type="submit">Submit</Button>
                <Button secondary>
                  Reset
                </Button>
              </Flexbox>
            </Flexbox>
          </WidgetWrapper>
        </Flexbox>
      </Section>
      <Section title="Card">
        <WidgetWrapper>
          <Flexbox gap="md">
            <Card>
              <Text>Hello world</Text>
            </Card>
            <Card fullWidth>
              <Flexbox
                alignItems="center"
                justifyContent="space-between"
                flexDirection="row"
              >
                <Text>Text 1</Text>
                <Text>Text 2</Text>
              </Flexbox>
            </Card>
          </Flexbox>
        </WidgetWrapper>
      </Section>
      <Section title="Checkbox">
        <WidgetWrapper>
          <Flexbox gap="md">
            <Checkbox
              name="checkbox-1"
              label="This is a checkbox"
              checked={false}
              value="test"
              onChange={(data) => alert(JSON.stringify(data))}
            />
            <Checkbox
              name="checkbox-2"
              label="This is a checked checkbox"
              checked={true}
              value="test"
              onChange={(data) => alert(JSON.stringify(data))}
            />
            <Checkbox
              name="checkbox-3"
              label="Disabled checkbox"
              checked={true}
              value="test2"
              disabled
            />
          </Flexbox>
        </WidgetWrapper>
      </Section>
      <Section title="Circular Progress">
        <Flexbox gap="md">
          <WidgetWrapper>
            <Flexbox gap="md">
              <CircularProgress value={33} size="sm" />
              <CircularProgress value={33} />
              <CircularProgress value={33} size="lg" />
            </Flexbox>
          </WidgetWrapper>
          <WidgetWrapper>
            <Timer value={0} initialTime={600} interval={1_000} />
          </WidgetWrapper>
        </Flexbox>
      </Section>
      <Section title="Combobox">
        WIP (+ search with chip)... N.B. create example with LLM list/search
      </Section>
      <Section title="Flexbox">
        <WidgetWrapper>
          <Flexbox gap="md">
            <Flexbox flexDirection="row" justifyContent="space-between">
              <Card>
                <Text>1</Text>
              </Card>
              <Card>
                <Text>2</Text>
              </Card>
              <Card>
                <Text>3</Text>
              </Card>
              <Card>
                <Text>4</Text>
              </Card>
              <Card>
                <Text>5</Text>
              </Card>
            </Flexbox>
            <Flexbox
              flexDirection="row"
              gap="md"
              justifyContent="space-between"
            >
              <Card fullWidth>
                <Flexbox justifyContent="center" alignItems="center">
                  <Text>1</Text>
                </Flexbox>
              </Card>
              <Card fullWidth>
                <Flexbox justifyContent="center" alignItems="center">
                  <Text>2</Text>
                </Flexbox>
              </Card>
              <Card fullWidth>
                <Flexbox justifyContent="center" alignItems="center">
                  <Text>3</Text>
                </Flexbox>
              </Card>
            </Flexbox>
            <Flexbox>
              <Card fullWidth>
                <Flexbox justifyContent="center" alignItems="center">
                  <Text>1</Text>
                </Flexbox>
              </Card>
            </Flexbox>
          </Flexbox>
        </WidgetWrapper>
      </Section>
      <Section title="Form">
        <WidgetWrapper>
          <Form
            onSubmit={(data) => {
              alert(JSON.stringify(data))
            }}
          >
            <Flexbox gap="md">
              <Checkbox name="ingredients[]" value="sugar" label="Sugar" />
              <Checkbox
                name="ingredients[]"
                value="eggs"
                label="Eggs"
                checked
              />
              <Checkbox name="ingredients[]" value="bread" label="Bread" />
              <Input name="username" placeholder="Enter your username..." />
              <Input type="date" name="date" placeholder="Date..." />
              <Input
                type="datetime-local"
                name="datetime-local"
                placeholder="Local datetime..."
              />
              <Input type="time" name="time" placeholder="Time..." />
              <Input
                type="email"
                name="email"
                placeholder="Enter your email..."
              />
              <Input
                name="password"
                placeholder="Enter your password..."
                type="password"
              />
              <Input name="content" placeholder="Your content..." multiline />
              <Text>Random size</Text>
              <RangeSlider name="random-size" min={0} max={100} step={10} />
              <Switch name="notification" label="Enable notifications" />
              <RadioGroup defaultValue="lemon" name="fruit">
                <Flexbox gap="md">
                  <Radio label="Strawberry" value="strawberry" />
                  <Radio label="Apple" value="apple" />
                  <Radio label="Lemon" value="lemon" />
                </Flexbox>
              </RadioGroup>
              <Select
                name="language"
                placeholder="Your favorite programming language"
              >
                <SelectOption value="javascript" label="JavaScript" />
                <SelectOption value="python" label="Python" />
                <SelectOption value="java" label="Java" />
                <SelectOption value="csharp" label="C#" />
                <SelectOption value="c++" label="C++" />
                <SelectOption value="ruby" label="Ruby" />
              </Select>
              <Checkbox
                name="terms"
                label="I agree to the terms and conditions"
                checked={false}
                value="terms"
              />
              <Button type="submit">Submit</Button>
            </Flexbox>
          </Form>
        </WidgetWrapper>
      </Section>
      <Section title="Icon">
        <WidgetWrapper>
          <Flexbox alignItems="center" gap="xs" flexDirection="row">
            <Icon iconName="home-heart" size="md" />
            <Text>Test here</Text>
          </Flexbox>
          <Flexbox flexDirection="row" gap="md">
            <Icon iconName="home-heart" size="xs" />
            <Icon iconName="home-heart" size="sm" />
            <Icon iconName="home-heart" size="md" bgColor="blue" />
            <Icon
              iconName="home-heart"
              size="md"
              bgColor="secondary-yellow"
              color="yellow"
            />
            <Icon
              iconName="home-heart"
              size="lg"
              color="yellow"
              bgColor="transparent-yellow"
            />
            <Icon iconName="home-heart" size="lg" color="blue" />
            <Icon iconName="home-heart" size="xl" bgColor="blue" />
            <Icon
              iconName="home-heart"
              size="xl"
              color="red"
              bgColor="transparent-red"
            />
          </Flexbox>
        </WidgetWrapper>
      </Section>
      <Section title="Icon Button">
        <Flexbox gap="md">
          <WidgetWrapper>
            <Flexbox gap="md">
              <Flexbox flexDirection="row" gap="md">
                <IconButton
                  iconName="mail"
                  name="mail"
                  value="send"
                  loading={isSendingIconButton}
                  onClick={(data) => {
                    setIsSendingIconButton(true)

                    alert(JSON.stringify(data))

                    setTimeout(() => {
                      setIsSendingIconButton(false)
                    }, 2_000)
                  }}
                />
                <IconButton iconName="mail" loading />
                <IconButton iconName="mail" disabled />
              </Flexbox>
              <Flexbox flexDirection="row" gap="md">
                <IconButton iconName="mail" secondary />
                <IconButton iconName="mail" shape="circle" secondary />
                <IconButton iconName="mail" shape="circle" secondary disabled />
              </Flexbox>
              <Flexbox flexDirection="row" gap="md">
                <IconButton iconName="delete-bin" danger />
                <IconButton iconName="delete-bin" shape="circle" danger />
                <IconButton iconName="delete-bin" disabled danger />
              </Flexbox>
              <Flexbox flexDirection="row" gap="md">
                <IconButton
                  iconName="send-plane"
                  name="send"
                  value="plane"
                  light
                  iconType="line"
                  activated={false}
                  onClick={(data) => console.log('data', data)}
                />
                <IconButton
                  iconName="send-plane"
                  name="send"
                  value="plane"
                  light
                  iconType="fill"
                  activated={false}
                  onClick={(data) => console.log('data', data)}
                />
                <IconButton
                  iconName="send-plane"
                  light
                  iconType="fill"
                  disabled
                />
              </Flexbox>
              <Flexbox flexDirection="row" gap="md">
                <IconButton
                  iconName="send-plane"
                  light
                  secondary
                  iconType="line"
                  activated={false}
                  onClick={(data) => console.log('data', data)}
                />
                <IconButton
                  iconName="send-plane"
                  light
                  secondary
                  iconType="fill"
                  activated={false}
                  onClick={(data) => console.log('data', data)}
                />
                <IconButton
                  iconName="send-plane"
                  light
                  secondary
                  iconType="fill"
                  disabled
                />
              </Flexbox>
            </Flexbox>
          </WidgetWrapper>
          <WidgetWrapper>
            <Flexbox
              justifyContent="space-between"
              alignItems="center"
              flexDirection="row"
            >
              <IconButton
                iconName="shuffle"
                light
                activated
                onClick={(data) => console.log('Shuffle', data.isActivated)}
              />
              <Flexbox flexDirection="row">
                <IconButton
                  iconName="skip-left"
                  size="lg"
                  light
                  iconType="fill"
                />
                <IconButton
                  iconName={isPlayButtonActivated ? 'pause' : 'play'}
                  size="lg"
                  shape="circle"
                  iconType="fill"
                  activated={false}
                  onClick={(data) => {
                    console.log('Play', data.isActivated)
                    setIsPlayButtonActivated(data.isActivated)
                  }}
                />
                <IconButton
                  iconName="skip-right"
                  size="lg"
                  light
                  iconType="fill"
                />
              </Flexbox>
              <IconButton
                iconName="repeat"
                light
                activated={false}
                onClick={(data) => console.log('Repeat', data.isActivated)}
              />
            </Flexbox>
          </WidgetWrapper>
          <WidgetWrapper>
            <Flexbox gap="md" flexDirection="row">
              <IconButton iconName="mail" size="xs" />
              <IconButton iconName="mail" size="sm" />
              <IconButton iconName="mail" size="md" />
              <IconButton iconName="mail" size="lg" />
            </Flexbox>
          </WidgetWrapper>
        </Flexbox>
      </Section>
      <Section title="Image">
        <WidgetWrapper>
          <Flexbox gap="md">
            <Flexbox flexDirection="row" gap="md">
              <Image
                src="https://placehold.co/512/333/FFF"
                width={128}
                height={128}
              />
              <Image
                src="https://placehold.co/512/333/FFF"
                shape="circle"
                width={128}
                height={128}
              />
            </Flexbox>
            <Image
              src="https://placehold.co/512/333/FFF"
              width="100%"
              height={300}
            />
            <Flexbox flexDirection="row" gap="md">
              <Image
                src="https://placehold.co/512/333/FFF"
                width={64}
                height={64}
                borderColor="white"
              />
              <Image
                src="https://placehold.co/512/333/FFF"
                width={64}
                height={64}
                borderColor="blue"
              />
              <Image
                src="https://placehold.co/512/333/FFF"
                width={64}
                height={64}
                borderColor="blue"
                shape="circle"
              />
            </Flexbox>
            <Flexbox flexDirection="row" gap="md">
              <Image
                src="https://placehold.co/512/333/FFF"
                gradient
                width={128}
                height={128}
              />
              <Image
                src="https://placehold.co/512/333/FFF"
                gradient
                gradientPosition="top"
                width={128}
                height={128}
              />
            </Flexbox>
            <Flexbox flexDirection="row" gap="md">
              <Image
                src="https://placehold.co/512/333/FFF"
                gradient
                gradientPosition="left"
                width={128}
                height={128}
              />
              <Image
                src="https://placehold.co/512/333/FFF"
                gradient
                gradientPosition="right"
                width={128}
                height={128}
              />
            </Flexbox>
          </Flexbox>
        </WidgetWrapper>
      </Section>
      <Section title="Link">
        <WidgetWrapper>
          <Flexbox gap="md">
            <Flexbox flexDirection="row" gap="md">
              <Link href="https://docs.getleon.ai/">Docs</Link>
              <Link href="https://docs.getleon.ai/">
                <Icon iconName="file" />
                Docs
              </Link>
              <Link href="https://docs.getleon.ai/">
                Next
                <Icon iconName="arrow-right" />
              </Link>
            </Flexbox>
            <Flexbox flexDirection="row" gap="md">
              <Link href="https://docs.getleon.ai/" fontSize="sm">
                Docs
              </Link>
              <Link href="https://docs.getleon.ai/" fontSize="sm">
                <Icon iconName="file" size="sm" />
                Docs
              </Link>
              <Link href="https://docs.getleon.ai/" fontSize="sm">
                Next
                <Icon iconName="arrow-right" size="sm" />
              </Link>
            </Flexbox>
          </Flexbox>
        </WidgetWrapper>
      </Section>
      <Section title="List">
        <Flexbox gap="md">
          <WidgetWrapper noPadding>
            <List>
              <ListHeader>Shopping List</ListHeader>
              <ListItem>
                <Checkbox
                  name="item1"
                  label="Potatoes"
                  value="item1"
                  checked={false}
                  onChange={(data) => console.log('Checkbox', data)}
                />
              </ListItem>
              <ListItem>
                <Checkbox
                  name="item2"
                  value="item2"
                  checked={false}
                  label="2 bottles of milk"
                />
              </ListItem>
              <ListItem>
                <Checkbox
                  name="item3"
                  value="item3"
                  checked={false}
                  label="One bottle of orange juice but not the same as the last time"
                />
              </ListItem>
              <ListItem>
                <Checkbox
                  name="item4"
                  value="item4"
                  checked={false}
                  label="2 bottles of milk"
                />
              </ListItem>
              <ListItem>
                <Checkbox
                  name="item5"
                  value="item5"
                  checked={true}
                  label="1kg of rice"
                />
              </ListItem>
              <ListItem>
                <Checkbox
                  name="item5"
                  value="item5"
                  checked={true}
                  label="Shampoo"
                />
              </ListItem>
            </List>
          </WidgetWrapper>
          <WidgetWrapper noPadding>
            <List>
              <ListHeader>You are all set</ListHeader>
              <ListItem>
                <Flexbox flexDirection="row" alignItems="center" gap="sm">
                  <Icon
                    iconName="check"
                    size="sm"
                    type="fill"
                    bgShape="circle"
                    color="green"
                    bgColor="transparent-green"
                  />
                  <Text>Installation is done</Text>
                </Flexbox>
              </ListItem>
              <ListItem>
                <Flexbox flexDirection="row" alignItems="center" gap="sm">
                  <Icon
                    iconName="check"
                    size="sm"
                    type="fill"
                    bgShape="circle"
                    color="green"
                    bgColor="transparent-green"
                  />
                  <Text>Configuration is done</Text>
                </Flexbox>
              </ListItem>
              <ListItem>
                <Flexbox flexDirection="row" alignItems="center" gap="sm">
                  <Icon
                    iconName="check"
                    size="sm"
                    type="fill"
                    bgShape="circle"
                    color="green"
                    bgColor="transparent-green"
                  />
                  <Text>I’m ready to help</Text>
                </Flexbox>
              </ListItem>
            </List>
          </WidgetWrapper>
          <WidgetWrapper noPadding>
            <List>
              <ListItem>
                <Flexbox flexDirection="row" alignItems="center" gap="sm">
                  <Icon
                    iconName="alert"
                    size="sm"
                    type="fill"
                    bgShape="circle"
                    color="yellow"
                    bgColor="transparent-yellow"
                  />
                  <Text>The voice provider is missing</Text>
                </Flexbox>
              </ListItem>
              <ListItem>
                <Flexbox flexDirection="row" alignItems="center" gap="sm">
                  <Icon
                    iconName="close"
                    size="sm"
                    type="fill"
                    bgShape="circle"
                    color="red"
                    bgColor="transparent-red"
                  />
                  <Text>NLP models are broken</Text>
                </Flexbox>
              </ListItem>
              <ListItem>
                <Flexbox flexDirection="row" alignItems="center" gap="sm">
                  <Icon
                    iconName="close"
                    size="sm"
                    type="fill"
                    bgShape="circle"
                    color="red"
                    bgColor="transparent-red"
                  />
                  <Text>I cannot run properly</Text>
                </Flexbox>
              </ListItem>
            </List>
          </WidgetWrapper>
          <WidgetWrapper noPadding>
            <List>
              <ListHeader align="center">Select your music provider</ListHeader>
              <ListItem
                align="center"
                name="music-provider"
                value="spotify"
                onClick={(data) => alert(JSON.stringify(data))}
              >
                <Image
                  src="/spotify.svg"
                  width={110}
                  height={31}
                  backgroundSize="contain"
                />
              </ListItem>
              <ListItem
                align="center"
                name="music-provider"
                value="apple-music"
                onClick={(data) => alert(JSON.stringify(data))}
              >
                <Image
                  src="/apple-music.svg"
                  width={110}
                  height={31}
                  backgroundSize="contain"
                />
              </ListItem>
              <ListItem
                align="center"
                name="music-provider"
                value="youtube-music"
                onClick={(data) => alert(JSON.stringify(data))}
              >
                <Image
                  src="/youtube-music.svg"
                  width={110}
                  height={31}
                  backgroundSize="contain"
                />
              </ListItem>
              <ListItem
                align="center"
                name="music-provider"
                value="deezer"
                onClick={(data) => alert(JSON.stringify(data))}
              >
                <Image
                  src="/deezer.svg"
                  width={110}
                  height={31}
                  backgroundSize="contain"
                />
              </ListItem>
            </List>
          </WidgetWrapper>
          <WidgetWrapper noPadding>
            <Image
              width="100%"
              height={200}
              radiusTop
              overlay
              gradient
              gradientPosition="bottom"
              src="/pancakes.jpeg"
            />
            <List>
              <ListHeader>
                <Icon iconName="book-2" />
                Pancakes Ingredients
              </ListHeader>
              <ListItem>
                <Flexbox flexDirection="row" gap="md" alignItems="center">
                  <Image src="/flour.jpeg" width={64} height={64} />
                  <Flexbox>
                    <Text fontWeight="semi-bold">Flour</Text>
                    <Text secondary>1 ½ cups</Text>
                  </Flexbox>
                </Flexbox>
              </ListItem>
              <ListItem>
                <Flexbox flexDirection="row" gap="md" alignItems="center">
                  <Image src="/baking-powder.jpeg" width={64} height={64} />
                  <Flexbox>
                    <Text fontWeight="semi-bold">Baking powder</Text>
                    <Text secondary>3 ½ teaspoons</Text>
                  </Flexbox>
                </Flexbox>
              </ListItem>
              <ListItem>
                <Flexbox flexDirection="row" gap="md" alignItems="center">
                  <Image src="/sugar.jpg" width={64} height={64} />
                  <Flexbox>
                    <Text fontWeight="semi-bold">Sugar</Text>
                    <Text secondary>1 tablespoon</Text>
                  </Flexbox>
                </Flexbox>
              </ListItem>
              <ListItem>
                <Flexbox flexDirection="row" gap="md" alignItems="center">
                  <Image src="/salt.jpg" width={64} height={64} />
                  <Flexbox>
                    <Text fontWeight="semi-bold">Salt</Text>
                    <Text secondary>¼ teaspoon</Text>
                  </Flexbox>
                </Flexbox>
              </ListItem>
              <ListItem>
                <Flexbox flexDirection="row" gap="md" alignItems="center">
                  <Image src="/milk.jpeg" width={64} height={64} />
                  <Flexbox>
                    <Text fontWeight="semi-bold">Milk</Text>
                    <Text secondary>1 ¼ cups</Text>
                  </Flexbox>
                </Flexbox>
              </ListItem>
              <ListItem>
                <Flexbox flexDirection="row" gap="md" alignItems="center">
                  <Image src="/butter.jpeg" width={64} height={64} />
                  <Flexbox>
                    <Text fontWeight="semi-bold">Butter</Text>
                    <Text secondary>3 tablespoons butter</Text>
                  </Flexbox>
                </Flexbox>
              </ListItem>
              <ListItem>
                <Flexbox flexDirection="row" gap="md" alignItems="center">
                  <Image src="/egg.webp" width={64} height={64} />
                  <Flexbox>
                    <Text fontWeight="semi-bold">Egg</Text>
                    <Text secondary>1 egg</Text>
                  </Flexbox>
                </Flexbox>
              </ListItem>
            </List>
          </WidgetWrapper>
        </Flexbox>
      </Section>
      <Section title="Loader">
        <WidgetWrapper>
          <Loader />
        </WidgetWrapper>
      </Section>
      <Section title="Modal">
        WIP (need methods from SDK to control)... N.B. make blurred bg
      </Section>
      <Section title="Progress">
        <Flexbox flexDirection="row" gap="md">
          <WidgetWrapper>
            <Flexbox gap="md">
              <Progress value={72} size="sm" />
              <Progress value={72} />
              <Progress value={72} size="lg" />
            </Flexbox>
          </WidgetWrapper>
          <WidgetWrapper>
            <Flexbox flexDirection="row" gap="md">
              <Progress value={72} size="sm" orientation="vertical" />
              <Progress value={72} orientation="vertical" />
              <Progress value={72} size="lg" orientation="vertical" />
            </Flexbox>
          </WidgetWrapper>
        </Flexbox>
      </Section>
      <Section title="Radio">
        <WidgetWrapper>
          <RadioGroup
            defaultValue="orange"
            name="fruit"
            onChange={(data) => alert(JSON.stringify(data))}
          >
            <Flexbox gap="md">
              <Radio label="Strawberry" value="strawberry" />
              <Radio label="Apple" value="apple" />
              <Radio label="Lemon" value="lemon" />
              <Radio label="Orange" value="orange" disabled />
            </Flexbox>
          </RadioGroup>
        </WidgetWrapper>
      </Section>
      <Section title="Range Slider">
        <Flexbox gap="md">
          <WidgetWrapper>
            <Flexbox gap="lg">
              <RangeSlider
                name="slider-1"
                min={0}
                max={100}
                step={1}
                defaultValue={50}
                value={50}
                onChange={(data) => console.log(data)}
              />
              <RangeSlider
                hiddenThumb
                name="slider-2"
                min={0}
                max={100}
                step={1}
                defaultValue={72}
                value={72}
                onChange={(data) => console.log(data)}
              />
              <RangeSlider
                disabled
                name="slider-3"
                min={0}
                max={100}
                step={1}
                defaultValue={72}
                value={72}
                onChange={(data) => console.log(data)}
              />
            </Flexbox>
          </WidgetWrapper>
          <WidgetWrapper>
            <Flexbox flexDirection="row" gap="lg">
              <RangeSlider
                name="slider-4"
                height={164}
                min={0}
                max={100}
                step={1}
                defaultValue={50}
                value={50}
                orientation="vertical"
                onChange={(data) => console.log(data)}
              />
              <RangeSlider
                disabled
                name="slider-5"
                height={164}
                min={0}
                max={100}
                step={1}
                defaultValue={72}
                value={72}
                orientation="vertical"
                onChange={(data) => console.log(data)}
              />
            </Flexbox>
          </WidgetWrapper>
        </Flexbox>
      </Section>
      <Section title="Scroll Container">
        <Flexbox gap="md">
          <WidgetWrapper>
            <ScrollContainer>
              <Flexbox flexDirection="row" gap="md">
                <Card>
                  <Text>Card 1</Text>
                </Card>
                <Card>
                  <Text>Card 2</Text>
                </Card>
                <Card>
                  <Text>Card 3</Text>
                </Card>
                <Card>
                  <Text>Card 4</Text>
                </Card>
                <Card>
                  <Text>Card 5</Text>
                </Card>
              </Flexbox>
            </ScrollContainer>
          </WidgetWrapper>
          <WidgetWrapper>
            <ScrollContainer orientation="vertical" height={200}>
              <Flexbox gap="md">
                <Card>
                  <Text>Card 1</Text>
                </Card>
                <Card>
                  <Text>Card 2</Text>
                </Card>
                <Card>
                  <Text>Card 3</Text>
                </Card>
                <Card>
                  <Text>Card 4</Text>
                </Card>
                <Card>
                  <Text>Card 5</Text>
                </Card>
              </Flexbox>
            </ScrollContainer>
          </WidgetWrapper>
        </Flexbox>
      </Section>
      <Section title="Select">
        <WidgetWrapper>
          <Flexbox gap="md">
            <Select
              name="llm"
              placeholder="Choose your LLM solution"
              onChange={(data) => alert(JSON.stringify(data))}
            >
              <SelectOption value="gpt-4" label="GPT-4" />
              <SelectOption value="gpt-3.5" label="GPT-3.5" />
              <SelectOption value="claude" label="Claude" />
              <SelectOption value="falcon-7b" label="Falcon-7B" />
              <SelectOption value="mpt-7b" label="MPT-7B" disabled />
              <SelectOption value="dolly-v2-3b" label="Dolly-v2-3B" />
            </Select>
            <Select
              name="llm-2"
              placeholder="Choose your LLM solution"
              disabled
            >
              ...
            </Select>
          </Flexbox>
        </WidgetWrapper>
      </Section>
      <Section title="Status">
        <WidgetWrapper>
          <Flexbox flexDirection="row" gap="xs">
            <Status>Normal</Status>
            <Status color="blue">Edited</Status>
            <Status color="yellow">Warning</Status>
            <Status color="red" iconName="error-warning" iconType="fill">
              Danger
            </Status>
            <Status color="green" iconName="check">
              Success
            </Status>
          </Flexbox>
        </WidgetWrapper>
      </Section>
      <Section title="Switch">
        <WidgetWrapper>
          <Flexbox gap="md">
            <Switch
              checked={false}
              name="living-room"
              label="Living room light"
              onChange={(data) => alert(JSON.stringify(data))}
            />
            <Switch
              checked={true}
              name="kitchen"
              label="Kitchen light"
              onChange={(data) => alert(JSON.stringify(data))}
            />
            <Switch
              checked={true}
              disabled
              name="entrance"
              label="Entrance light"
              onChange={(data) => alert(JSON.stringify(data))}
            />
          </Flexbox>
        </WidgetWrapper>
      </Section>
      <Section title="Tabs">
        <WidgetWrapper>
          <TabGroup defaultValue="first">
            <TabList>
              <Tab value="first">Tab 1</Tab>
              <Tab value="second">Tab 2</Tab>
              <Tab value="third" disabled>
                Tab 3
              </Tab>
            </TabList>
            <TabContent value="first">
              <Text>Tab 1 content</Text>
            </TabContent>
            <TabContent value="second">
              <Text>Tab 2 content</Text>
            </TabContent>
            <TabContent value="third">
              <Text>Tab 3 content</Text>
            </TabContent>
          </TabGroup>
        </WidgetWrapper>
      </Section>
      <Section title="Text">
        <WidgetWrapper>
          <Flexbox gap="xs">
            <Text fontSize="xs">Text xs</Text>
            <Text fontSize="sm">Text sm</Text>
            <Text fontSize="md">Text md</Text>
            <Text fontSize="lg">Text lg</Text>
            <Text fontSize="xl">Text xl</Text>
            <Text>Text</Text>
            <Text fontWeight="regular">Text regular</Text>
            <Text fontWeight="semi-bold">Text semi-bold</Text>
            <Text secondary>Text secondary</Text>
          </Flexbox>
        </WidgetWrapper>
      </Section>
      <Section title="Text Input">
        <WidgetWrapper>
          <Flexbox gap="md" display="inline-flex" fullWidth>
            <Input
              name="password"
              type="password"
              placeholder="Your password"
            />
            <Input
              name="spotify-api-key"
              placeholder="Your Spotify API key"
              iconName="key-2"
              onChange={(value) => console.log('Text input value:', value)}
            />
            <Input
              name="email"
              type="email"
              placeholder="Your email address"
              iconName="mail"
              hint="I’ll notify you there once the task is over."
            />
            <Input
              name="email"
              type="email"
              placeholder="Your email address (disabled)"
              iconName="mail"
              value="louis@getleon.ai"
              disabled
            />
            <Input
              name="test"
              placeholder="Test"
              value="This is a test (disabled)"
              disabled
            />
            <Input name="multiline" placeholder="Multiline" multiline />
            <Input
              name="comment"
              placeholder="Your comment here..."
              multiline
              iconName="edit-2"
            />
            <Input
              name="email-content"
              placeholder="Your email content here..."
              multiline
              iconName="mail"
            />
            <Input
              name="content"
              placeholder="Content here... (custom height)"
              multiline
              height={200}
            />
            <Input
              name="multiline"
              placeholder="Multiline (disabled)"
              value="Multiline (disabled)"
              multiline
              disabled
            />
          </Flexbox>
        </WidgetWrapper>
      </Section>
      <Section title="Toast">WIP (need methods from SDK to control)...</Section>
      <Section title="Widget Wrapper">
        <Flexbox gap="md">
          <WidgetWrapper>
            <Flexbox alignItems="center" justifyContent="center">
              <Text fontSize="xl" fontWeight="semi-bold">
                42
              </Text>
            </Flexbox>
          </WidgetWrapper>
          <WidgetWrapper>
            <Flexbox rowGap="xl">
              <Flexbox alignItems="center" justifyContent="center" rowGap="xs">
                <Text fontSize="lg" fontWeight="semi-bold">
                  Paris
                </Text>
                <Text secondary>Thursday, 1 June</Text>
              </Flexbox>
              <Flexbox alignItems="center" justifyContent="center">
                <Icon
                  size="xxl"
                  svg={
                    <svg
                      viewBox="0 0 134 132"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        fillRule="evenodd"
                        clipRule="evenodd"
                        d="M72.5478 69.1152L80.4523 74.3849L66.3755 95.5001H90.5398L64.5174 131.531L56.8159 125.969L71.9601 105H48.6245L72.5478 69.1152Z"
                        fill="url(#paint0_linear_81_184)"
                      />
                      <path
                        fillRule="evenodd"
                        clipRule="evenodd"
                        d="M38.5 103.409C16.6613 97.684 0.5 77.174 0.5 52.75C0.5 23.8931 23.0601 0.5 50.8894 0.5C73.9775 0.5 93.4389 16.6014 99.3999 38.5659C100.073 38.5222 100.751 38.5 101.434 38.5C119.144 38.5 133.5 53.3865 133.5 71.7499C133.5 90.1133 119.144 105 101.434 105C101.038 105 100.643 104.992 100.25 104.978V95.5H101.689V95.4983C113.721 95.3553 124 85.1001 124 71.7499C124 58.3056 113.575 48 101.434 48C98.0042 48 94.7111 48.8226 91.7514 50.306C91.6005 47.5424 91.1952 44.8495 90.5594 42.2521L90.5451 42.2579C86.0435 23.5377 69.7734 10 50.8894 10C28.6285 10 10 28.8122 10 52.75C10 72.0623 22.1249 88.0384 38.5 93.4915V103.409Z"
                        fill="url(#paint1_linear_81_184)"
                      />
                      <defs>
                        <linearGradient
                          id="paint0_linear_81_184"
                          x1="69.5822"
                          y1="69.1152"
                          x2="69.5822"
                          y2="131.531"
                          gradientUnits="userSpaceOnUse"
                        >
                          <stop stopColor="#F5BD52" />
                          <stop offset="1" stopColor="#F5DA79" />
                        </linearGradient>
                        <linearGradient
                          id="paint1_linear_81_184"
                          x1="67"
                          y1="0.5"
                          x2="67"
                          y2="105"
                          gradientUnits="userSpaceOnUse"
                        >
                          <stop stopColor="#95B6F6" />
                          <stop offset="1" stopColor="#5193DE" />
                        </linearGradient>
                      </defs>
                    </svg>
                  }
                />
              </Flexbox>
              <Flexbox alignItems="center" justifyContent="center" rowGap="xs">
                <Text fontSize="xl" fontWeight="semi-bold">
                  18°
                </Text>
                <Text fontWeight="semi-bold">Thunderstorms</Text>
              </Flexbox>
              <Card fullWidth>
                <Flexbox justifyContent="space-between" flexDirection="row">
                  <Flexbox alignItems="center">
                    <Icon
                      svg={
                        <svg
                          width="26"
                          height="26"
                          viewBox="0 0 26 26"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            fillRule="evenodd"
                            clipRule="evenodd"
                            d="M12.125 3.375V0.75H13.875V3.375H12.125ZM17.0548 4.22708L18.3673 1.95377L19.8828 2.82877L18.5703 5.10208L17.0548 4.22708ZM13 19.125C16.3827 19.125 19.125 16.3827 19.125 13C19.125 9.61726 16.3827 6.875 13 6.875C9.61726 6.875 6.875 9.61726 6.875 13C6.875 16.3827 9.61726 19.125 13 19.125ZM13 20.875C17.3492 20.875 20.875 17.3492 20.875 13C20.875 8.65076 17.3492 5.125 13 5.125C8.65076 5.125 5.125 8.65076 5.125 13C5.125 17.3492 8.65076 20.875 13 20.875ZM22.625 12.125H25.25V13.875H22.625V12.125ZM23.1713 6.11723L20.898 7.42973L21.773 8.94527L24.0463 7.63277L23.1713 6.11723ZM6.11723 2.82877L7.42973 5.10208L8.94527 4.22708L7.63277 1.95377L6.11723 2.82877ZM4.22703 8.94527L1.95371 7.63277L2.82871 6.11723L5.10203 7.42973L4.22703 8.94527ZM12.125 22.625V25.25H13.875V22.625H12.125ZM3.375 12.125H0.75V13.875H3.375V12.125ZM1.95367 18.3672L4.22698 17.0547L5.10198 18.5703L2.82867 19.8828L1.95367 18.3672ZM7.42978 20.8981L6.11728 23.1714L7.63283 24.0464L8.94533 21.7731L7.42978 20.8981ZM18.3672 24.0464L17.0547 21.7731L18.5703 20.8981L19.8828 23.1714L18.3672 24.0464ZM20.898 18.5703L23.1713 19.8828L24.0463 18.3672L21.773 17.0547L20.898 18.5703Z"
                            fill="url(#paint0_linear_98_274)"
                          />
                          <defs>
                            <linearGradient
                              id="paint0_linear_98_274"
                              x1="13"
                              y1="0.75"
                              x2="13"
                              y2="25.25"
                              gradientUnits="userSpaceOnUse"
                            >
                              <stop stopColor="#EFC977" />
                              <stop offset="1" stopColor="#E07256" />
                            </linearGradient>
                          </defs>
                        </svg>
                      }
                    />
                    <Text fontSize="sm" fontWeight="semi-bold">
                      1
                    </Text>
                    <Text fontSize="xs" secondary>
                      UV Index
                    </Text>
                  </Flexbox>
                  <Flexbox alignItems="center">
                    <Icon
                      svg={
                        <svg
                          width="22"
                          height="17"
                          viewBox="0 0 22 17"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            fillRule="evenodd"
                            clipRule="evenodd"
                            d="M9.25012 3.62007L9.25012 3.61492L4.29697 3.61486L9.04818 1.89804L9.04766 1.89662C9.13865 1.87368 9.23281 1.86552 9.32652 1.87251C9.33888 1.87343 9.35124 1.87462 9.36358 1.87607L9.36376 1.87609C9.49244 1.89125 9.61614 1.9348 9.72593 2.00362L9.72594 2.00363C9.83573 2.07244 9.92887 2.16479 9.99863 2.274L9.99874 2.27418C10.0685 2.3834 10.1131 2.50674 10.1293 2.6353L10.1294 2.63555C10.1456 2.76416 10.133 2.89478 10.0926 3.01795L10.0926 3.01805C10.0522 3.14125 9.98486 3.25392 9.89556 3.34792L9.89547 3.348C9.80619 3.44195 9.69715 3.51489 9.57623 3.56153L9.576 3.56163C9.56463 3.56601 9.55318 3.57015 9.54166 3.57404C9.44775 3.60581 9.34916 3.62136 9.25012 3.62007ZM0.5 3.12588V5.36496L9.23212 5.36507C9.56375 5.36878 9.8936 5.30947 10.204 5.18973L10.2042 5.18964C10.4405 5.09847 10.6616 4.97378 10.861 4.81995C10.9672 4.73804 11.0672 4.64787 11.1601 4.55009L11.1602 4.55001C11.4275 4.2686 11.629 3.9313 11.7501 3.56247L11.7501 3.56237C11.8712 3.19354 11.9088 2.80242 11.8602 2.41728L11.8602 2.41704C11.8116 2.03189 11.6781 1.66236 11.4692 1.33515L11.4691 1.33498C11.2602 1.00774 10.9812 0.731029 10.6523 0.524867L10.6523 0.524857C10.538 0.453214 10.4186 0.390712 10.2954 0.337749C10.064 0.238303 9.81876 0.172484 9.56722 0.142911L9.56703 0.14289C9.19227 0.0988584 8.81256 0.136353 8.45385 0.252652L8.45358 0.251906L8.42673 0.261607L8.42357 0.262674L8.42321 0.262797L8.42323 0.262875L0.5 3.12588ZM0.5 10.6233V12.421L12.0551 16.5318L12.055 16.5321C12.4731 16.699 12.923 16.7715 13.3724 16.7446C13.5452 16.7342 13.7163 16.7093 13.8839 16.6702C14.1522 16.6076 14.4117 16.5089 14.655 16.3762C15.0502 16.1606 15.393 15.8604 15.659 15.497C15.925 15.1337 16.1076 14.7161 16.1938 14.2741C16.2799 13.832 16.2676 13.3764 16.1575 12.9397C16.0475 12.503 15.8426 12.096 15.5573 11.7476C15.3817 11.5331 15.1783 11.3442 14.9531 11.1853C14.8124 11.0861 14.6632 10.9987 14.507 10.9242C14.1013 10.7306 13.6579 10.6288 13.2084 10.6259V10.6233L0.5 10.6233ZM13.1965 12.3735L5.58821 12.3735L12.7362 14.9164L12.7355 14.9182C12.9054 14.9809 13.0866 15.0077 13.2676 14.9969C13.4601 14.9853 13.6476 14.9315 13.8168 14.8391C13.9861 14.7468 14.1329 14.6182 14.2468 14.4626C14.3607 14.3071 14.4389 14.1282 14.4758 13.939C14.5127 13.7497 14.5074 13.5546 14.4603 13.3676C14.4132 13.1806 14.3254 13.0062 14.2032 12.8571C14.0811 12.7079 13.9275 12.5875 13.7535 12.5045C13.5797 12.4215 13.3898 12.3779 13.1973 12.3767L13.1965 12.3767L13.1965 12.3764L13.1965 12.3735ZM17.1408 3.8421L17.14 3.84254L16.2794 2.31877L16.2784 2.31701L16.2801 2.31604C16.7461 2.05306 17.2661 1.90044 17.8003 1.8699C17.8778 1.86547 17.9552 1.86363 18.0326 1.86435C18.4892 1.8686 18.9413 1.96219 19.3632 2.14065C19.8566 2.34935 20.2955 2.66855 20.6461 3.07365C20.9967 3.47876 21.2497 3.95897 21.3856 4.47729C21.5214 4.99561 21.5365 5.53821 21.4297 6.06329C21.3229 6.58837 21.097 7.08192 20.7695 7.50592C20.4894 7.86846 20.1415 8.17188 19.7458 8.39966C19.6787 8.43828 19.6102 8.47472 19.5405 8.50891C19.0595 8.74476 18.5308 8.86701 17.9951 8.86627V8.86601H0.5V7.11601H17.9976L17.9976 7.11412C18.2651 7.11449 18.5293 7.05342 18.7695 6.93561C19.0098 6.8178 19.2198 6.64639 19.3835 6.43458C19.5471 6.22278 19.6599 5.97623 19.7133 5.71394C19.7666 5.45164 19.7591 5.18059 19.6912 4.92168C19.6233 4.66276 19.497 4.42288 19.3218 4.22051C19.1467 4.01814 18.9274 3.8587 18.681 3.75444C18.4345 3.65019 18.1674 3.60392 17.9002 3.61919C17.6334 3.63445 17.3736 3.71071 17.1408 3.8421Z"
                            fill="url(#paint0_linear_98_290)"
                          />
                          <defs>
                            <linearGradient
                              id="paint0_linear_98_290"
                              x1="11"
                              y1="0.125"
                              x2="11"
                              y2="16.7501"
                              gradientUnits="userSpaceOnUse"
                            >
                              <stop stopColor="#CED3EA" />
                              <stop offset="1" stopColor="#7E83A9" />
                            </linearGradient>
                          </defs>
                        </svg>
                      }
                    />
                    <Text fontSize="sm" fontWeight="semi-bold">
                      10 m/s
                    </Text>
                    <Text fontSize="xs" secondary>
                      Wind
                    </Text>
                  </Flexbox>
                  <Flexbox alignItems="center">
                    <Icon
                      svg={
                        <svg
                          width="16"
                          height="20"
                          viewBox="0 0 16 22"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            fillRule="evenodd"
                            clipRule="evenodd"
                            d="M14.125 14.8183C14.125 17.2834 11.6634 19.75 8 19.75C4.33662 19.75 1.875 17.2834 1.875 14.8183C1.875 12.2614 3.53802 9.0771 5.4927 6.30502C6.37618 5.05209 7.26285 3.9607 7.95623 3.15447C8.6628 4.0237 9.57962 5.20696 10.4931 6.54233C11.4456 7.93465 12.372 9.45984 13.0546 10.9442C13.7497 12.4558 14.125 13.783 14.125 14.8183ZM0.125 14.8183C0.125 10.0611 4.61482 4.3246 6.81418 1.79993C7.52759 0.980991 8 0.5 8 0.5C8 0.5 8.45258 1.0003 9.14075 1.83835C11.3232 4.49612 15.875 10.5509 15.875 14.8183C15.875 18.5085 12.3492 21.5 8 21.5C3.65076 21.5 0.125 18.5085 0.125 14.8183ZM4.06105 11.875H5.94368C5.58945 12.6834 5.375 13.4501 5.375 14.1024C5.375 15.1039 6.35468 16.25 8 16.25V18C5.58375 18 3.625 16.255 3.625 14.1024C3.625 13.384 3.79213 12.6275 4.06105 11.875Z"
                            fill="url(#paint0_linear_98_327)"
                          />
                          <defs>
                            <linearGradient
                              id="paint0_linear_98_327"
                              x1="8"
                              y1="0.5"
                              x2="8"
                              y2="21.5"
                              gradientUnits="userSpaceOnUse"
                            >
                              <stop stopColor="#95B6F6" />
                              <stop offset="1" stopColor="#5193DE" />
                            </linearGradient>
                          </defs>
                        </svg>
                      }
                    />
                    <Text fontSize="sm" fontWeight="semi-bold">
                      98%
                    </Text>
                    <Text fontSize="xs" secondary>
                      Humidity
                    </Text>
                  </Flexbox>
                </Flexbox>
              </Card>
              <TabGroup defaultValue="today" size="sm">
                <TabList>
                  <Tab value="today">Today</Tab>
                  <Tab value="tomorrow">Tomorrow</Tab>
                  <Tab value="next">Next 7 days</Tab>
                </TabList>
                <TabContent value="today">
                  <ScrollContainer>
                    <Flexbox gap="md" flexDirection="row">
                      <Card>
                        <Flexbox
                          gap="xs"
                          alignItems="center"
                          justifyContent="center"
                        >
                          <Text fontSize="xs" secondary>
                            10:00
                          </Text>
                          <Icon
                            svg={
                              <svg
                                width="26"
                                height="25"
                                viewBox="0 0 26 25"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path
                                  fillRule="evenodd"
                                  clipRule="evenodd"
                                  d="M14.0219 13.3896L15.478 14.3604L12.8849 18.25H17.3362L12.5426 24.8873L11.1239 23.8627L13.9137 20H9.61499L14.0219 13.3896Z"
                                  fill="url(#paint0_linear_101_318)"
                                />
                                <path
                                  fillRule="evenodd"
                                  clipRule="evenodd"
                                  d="M7.75 19.7069C3.72708 18.6523 0.75 14.8742 0.75 10.375C0.75 5.05926 4.9058 0.75 10.0323 0.75C14.2853 0.75 17.8703 3.71604 18.9684 7.76213C19.0923 7.75409 19.2173 7.75001 19.3431 7.75001C22.6054 7.75001 25.25 10.4923 25.25 13.875C25.25 17.2577 22.6054 20 19.3431 20C19.2701 20 19.1974 19.9986 19.125 19.9959V18.25H19.3901V18.2497C21.6064 18.2233 23.5 16.3342 23.5 13.875C23.5 11.3984 21.5796 9.50001 19.3431 9.50001C18.7113 9.50001 18.1047 9.65152 17.5595 9.92479C17.5317 9.41571 17.457 8.91964 17.3399 8.44118L17.3373 8.44225C16.508 4.99379 13.5109 2.5 10.0323 2.5C5.93157 2.5 2.5 5.96541 2.5 10.375C2.5 13.9325 4.73353 16.8755 7.75 17.88V19.7069Z"
                                  fill="url(#paint1_linear_101_318)"
                                />
                                <defs>
                                  <linearGradient
                                    id="paint0_linear_101_318"
                                    x1="13.4756"
                                    y1="13.3896"
                                    x2="13.4756"
                                    y2="24.8873"
                                    gradientUnits="userSpaceOnUse"
                                  >
                                    <stop stopColor="#F5BD52" />
                                    <stop offset="1" stopColor="#F5DA79" />
                                  </linearGradient>
                                  <linearGradient
                                    id="paint1_linear_101_318"
                                    x1="13"
                                    y1="0.75"
                                    x2="13"
                                    y2="20"
                                    gradientUnits="userSpaceOnUse"
                                  >
                                    <stop stopColor="#95B6F6" />
                                    <stop offset="1" stopColor="#5193DE" />
                                  </linearGradient>
                                </defs>
                              </svg>
                            }
                          />
                          <Text fontSize="sm" fontWeight="semi-bold">
                            15°
                          </Text>
                        </Flexbox>
                      </Card>
                      <Card>
                        <Flexbox
                          gap="xs"
                          alignItems="center"
                          justifyContent="center"
                        >
                          <Text fontSize="xs" secondary>
                            11:00
                          </Text>
                          <Icon
                            svg={
                              <svg
                                width="26"
                                height="25"
                                viewBox="0 0 26 25"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path
                                  fillRule="evenodd"
                                  clipRule="evenodd"
                                  d="M22.6856 9.65097C23.199 8.91404 23.5001 8.0181 23.5001 7.05184C23.5001 4.53793 21.4622 2.5 18.9483 2.5C17.7989 2.5 16.7489 2.92603 15.9478 3.62879C15.4876 3.24821 14.9879 2.91381 14.4556 2.63269C15.5987 1.4706 17.1894 0.75 18.9483 0.75C22.4287 0.75 25.2501 3.57143 25.2501 7.05184C25.2501 8.61613 24.6801 10.0473 23.7365 11.149C23.4619 10.5972 23.1064 10.0927 22.6856 9.65097Z"
                                  fill="url(#paint0_linear_101_219)"
                                />
                                <path
                                  fillRule="evenodd"
                                  clipRule="evenodd"
                                  d="M25.25 13.875C25.25 16.7083 23.3946 19.0923 20.875 19.792V17.9408C22.39 17.3065 23.5 15.7578 23.5 13.875C23.5 11.3984 21.5796 9.50001 19.3431 9.50001C18.7113 9.50001 18.1047 9.65151 17.5595 9.92476C17.5317 9.41569 17.457 8.91962 17.3399 8.44116L17.3372 8.44225C16.508 4.99378 13.5109 2.5 10.0323 2.5C5.93157 2.5 2.5 5.96541 2.5 10.375C2.5 13.2005 3.90892 15.6383 6 17.0252V19.0469C2.89321 17.4908 0.75 14.1924 0.75 10.375C0.75 5.05926 4.90581 0.75 10.0323 0.75C14.2853 0.75 17.8703 3.71604 18.9684 7.76213C19.0923 7.75409 19.2172 7.75001 19.3431 7.75001C22.6054 7.75001 25.25 10.4923 25.25 13.875ZM7.75092 18.608C7.75079 18.1894 7.88412 17.7345 8.0658 17.3089C8.45386 16.3999 9.0625 15.625 9.0625 15.625C9.0625 15.625 9.64373 16.4278 10.0329 17.3096C10.2286 17.7531 10.3758 18.2166 10.3759 18.608C10.3762 19.3768 9.78872 20 9.06384 20C8.33897 20 7.75115 19.3768 7.75092 18.608ZM12.4408 17.3089C12.2591 17.7345 12.1258 18.1894 12.1259 18.608C12.1262 19.3768 12.714 20 13.4388 20C14.1637 20 14.7512 19.3768 14.7509 18.608C14.7508 18.2166 14.6036 17.7531 14.4079 17.3096C14.0187 16.4278 13.4375 15.625 13.4375 15.625C13.4375 15.625 12.8289 16.3999 12.4408 17.3089ZM10.2661 22.983C10.266 22.5644 10.3993 22.1095 10.581 21.6839C10.9691 20.7749 11.5777 20 11.5777 20C11.5777 20 12.1589 20.8028 12.5481 21.6846C12.7438 22.1281 12.891 22.5916 12.8911 22.983C12.8913 23.7518 12.3039 24.375 11.579 24.375C10.8542 24.375 10.2663 23.7518 10.2661 22.983ZM16.8158 17.3089C16.6341 17.7345 16.5008 18.1894 16.5009 18.608C16.5012 19.3768 17.089 20 17.8138 20C18.5387 20 19.1262 19.3768 19.1259 18.608C19.1258 18.2166 18.9786 17.7531 18.7829 17.3096C18.3937 16.4278 17.8125 15.625 17.8125 15.625C17.8125 15.625 17.2039 16.3999 16.8158 17.3089ZM14.6541 22.983C14.654 22.5644 14.7873 22.1095 14.969 21.6839C15.3571 20.7749 15.9657 20 15.9657 20C15.9657 20 16.547 20.8028 16.9361 21.6846C17.1319 22.1281 17.279 22.5916 17.2791 22.983C17.2794 23.7518 16.6919 24.375 15.9671 24.375C15.2422 24.375 14.6544 23.7518 14.6541 22.983Z"
                                  fill="url(#paint1_linear_101_219)"
                                />
                                <defs>
                                  <linearGradient
                                    id="paint0_linear_101_219"
                                    x1="19.8528"
                                    y1="0.75"
                                    x2="19.8528"
                                    y2="11.1491"
                                    gradientUnits="userSpaceOnUse"
                                  >
                                    <stop stopColor="#EFC977" />
                                    <stop offset="1" stopColor="#E07256" />
                                  </linearGradient>
                                  <linearGradient
                                    id="paint1_linear_101_219"
                                    x1="13"
                                    y1="0.75"
                                    x2="13"
                                    y2="24.375"
                                    gradientUnits="userSpaceOnUse"
                                  >
                                    <stop stopColor="#95B6F6" />
                                    <stop offset="1" stopColor="#5193DE" />
                                  </linearGradient>
                                </defs>
                              </svg>
                            }
                          />
                          <Text fontSize="sm" fontWeight="semi-bold">
                            15°
                          </Text>
                        </Flexbox>
                      </Card>
                      <Card>
                        <Flexbox
                          gap="xs"
                          alignItems="center"
                          justifyContent="center"
                        >
                          <Text fontSize="xs" secondary>
                            12:00
                          </Text>
                          <Icon
                            svg={
                              <svg
                                width="26"
                                height="26"
                                viewBox="0 0 26 26"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path
                                  fillRule="evenodd"
                                  clipRule="evenodd"
                                  d="M23.4811 10.5596C24.5707 9.52343 25.2499 8.05979 25.2499 6.4375C25.2499 3.29638 22.7035 0.75 19.5624 0.75C17.5975 0.75 15.8652 1.74647 14.8435 3.26165C15.2905 3.6844 15.695 4.15156 16.05 4.65606C16.7002 3.37661 18.029 2.5 19.5624 2.5C21.737 2.5 23.4999 4.26288 23.4999 6.4375C23.4999 7.40527 23.1508 8.29149 22.5716 8.97708C22.9545 9.44802 23.2635 9.9814 23.4811 10.5596Z"
                                  fill="url(#paint0_linear_101_293)"
                                />
                                <path
                                  fillRule="evenodd"
                                  clipRule="evenodd"
                                  d="M0.75 10.375C0.75 14.1924 2.89321 17.4908 6 19.0469V17.0252C3.90892 15.6383 2.5 13.2005 2.5 10.375C2.5 5.96541 5.93157 2.5 10.0323 2.5C13.5109 2.5 16.508 4.99379 17.3373 8.44225L17.3399 8.44118C17.457 8.91964 17.5317 9.41571 17.5595 9.92479C18.1047 9.65152 18.7113 9.50001 19.3431 9.50001C21.5796 9.50001 23.5 11.3984 23.5 13.875C23.5 15.3717 22.7986 16.6572 21.75 17.4402V19.4701C23.8126 18.5146 25.25 16.3689 25.25 13.875C25.25 10.4923 22.6054 7.75001 19.3431 7.75001C19.2173 7.75001 19.0923 7.75409 18.9684 7.76213C17.8703 3.71604 14.2853 0.75 10.0323 0.75C4.9058 0.75 0.75 5.05926 0.75 10.375ZM15.3791 16.6772C15.5625 16.7832 15.85 16.737 15.9969 16.4823C16.0774 16.3429 16.1809 16.0532 16.2558 15.5817C16.2857 15.3937 16.3082 15.1954 16.3245 14.9918C15.8135 15.3534 15.4263 15.7199 15.2389 16.0445C15.0919 16.2991 15.1956 16.5713 15.3791 16.6772ZM16.3201 12.9315C17.2321 12.4205 18.0043 12.1286 18.0043 12.1286C18.0043 12.1286 18.1053 12.9503 18.1093 13.9856C18.1136 15.1197 18.0014 16.5102 17.5123 17.3575C16.8973 18.4232 15.5506 18.7972 14.5043 18.1929C13.458 17.5886 13.1085 16.2349 13.7235 15.1693C14.2602 14.2393 15.3666 13.4657 16.3201 12.9315ZM9.60158 17.5678C9.78506 17.6738 10.0725 17.6275 10.2194 17.3729C10.2999 17.2334 10.4034 16.9438 10.4783 16.4723C10.5082 16.2843 10.5307 16.086 10.547 15.8824C10.036 16.244 9.64877 16.6105 9.46141 16.9351C9.31444 17.1897 9.4181 17.4619 9.60158 17.5678ZM10.5426 13.8221C11.4546 13.3111 12.2268 13.0192 12.2268 13.0192C12.2268 13.0192 12.3278 13.8409 12.3318 14.8762C12.3361 16.0103 12.2239 17.4007 11.7349 18.2481C11.1198 19.3138 9.77308 19.6878 8.72681 19.0835C7.68055 18.4792 7.33096 17.1255 7.94599 16.0599C8.48269 15.1299 9.58907 14.3563 10.5426 13.8221ZM17.9694 21.8487C17.8224 22.1034 17.535 22.1496 17.3515 22.0437C17.168 21.9377 17.0644 21.6656 17.2113 21.4109C17.3987 21.0863 17.7859 20.7198 18.297 20.3583C18.2806 20.5618 18.2581 20.7601 18.2282 20.9481C18.1533 21.4196 18.0499 21.7093 17.9694 21.8487ZM19.9767 17.495C19.9767 17.495 19.2046 17.7869 18.2925 18.2979C17.339 18.8321 16.2326 19.6058 15.6959 20.5357C15.0809 21.6013 15.4305 22.9551 16.4767 23.5593C17.523 24.1636 18.8697 23.7896 19.4848 22.724C19.9738 21.8766 20.086 20.4861 20.0817 19.352C20.0778 18.3167 19.9767 17.495 19.9767 17.495ZM11.473 23.4452C11.6565 23.5512 11.9439 23.505 12.0908 23.2503C12.1713 23.1109 12.2748 22.8212 12.3497 22.3497C12.3796 22.1617 12.4021 21.9634 12.4184 21.7598C11.9074 22.1214 11.5202 22.4879 11.3328 22.8125C11.1858 23.0671 11.2895 23.3393 11.473 23.4452ZM12.414 19.6995C13.326 19.1885 14.0982 18.8966 14.0982 18.8966C14.0982 18.8966 14.1992 19.7183 14.2032 20.7536C14.2075 21.8877 14.0953 23.2782 13.6062 24.1255C12.9912 25.1912 11.6445 25.5652 10.5982 24.9609C9.55194 24.3566 9.20235 23.0029 9.81739 21.9373C10.3541 21.0074 11.4605 20.2337 12.414 19.6995Z"
                                  fill="url(#paint1_linear_101_293)"
                                />
                                <defs>
                                  <linearGradient
                                    id="paint0_linear_101_293"
                                    x1="20.0467"
                                    y1="0.75"
                                    x2="20.0467"
                                    y2="10.5596"
                                    gradientUnits="userSpaceOnUse"
                                  >
                                    <stop stopColor="#EFC977" />
                                    <stop offset="1" stopColor="#E07256" />
                                  </linearGradient>
                                  <linearGradient
                                    id="paint1_linear_101_293"
                                    x1="13"
                                    y1="0.75"
                                    x2="13"
                                    y2="25.2499"
                                    gradientUnits="userSpaceOnUse"
                                  >
                                    <stop stopColor="#95B6F6" />
                                    <stop offset="1" stopColor="#5193DE" />
                                  </linearGradient>
                                </defs>
                              </svg>
                            }
                          />
                          <Text fontSize="sm" fontWeight="semi-bold">
                            15°
                          </Text>
                        </Flexbox>
                      </Card>
                      <Card>
                        <Flexbox
                          gap="xs"
                          alignItems="center"
                          justifyContent="center"
                        >
                          <Text fontSize="xs" secondary>
                            13:00
                          </Text>
                          <Icon
                            svg={
                              <svg
                                width="26"
                                height="26"
                                viewBox="0 0 26 26"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path
                                  fillRule="evenodd"
                                  clipRule="evenodd"
                                  d="M12.125 0.75V3.375H13.875V0.75H12.125ZM17.0358 17.6075C18.3164 16.4848 19.125 14.8368 19.125 13C19.125 9.61726 16.3827 6.875 13 6.875C9.61726 6.875 6.875 9.61726 6.875 13C6.875 13.1241 6.87869 13.2473 6.88597 13.3696C6.28681 13.5801 5.72743 13.8752 5.22214 14.2404C5.1582 13.8364 5.125 13.4221 5.125 13C5.125 8.65076 8.65076 5.125 13 5.125C17.3492 5.125 20.875 8.65076 20.875 13C20.875 15.16 20.0054 17.1168 18.5972 18.5396C18.1525 18.1277 17.6222 17.8071 17.0358 17.6075ZM22.625 12.125H25.25V13.875H22.625V12.125ZM23.1713 6.11723L20.898 7.42973L21.773 8.94527L24.0463 7.63277L23.1713 6.11723ZM17.0548 4.22708L18.3673 1.95377L19.8828 2.82877L18.5703 5.10208L17.0548 4.22708ZM6.11723 2.82877L7.42973 5.10208L8.94527 4.22708L7.63277 1.95377L6.11723 2.82877ZM4.22703 8.94527L1.95371 7.63277L2.82871 6.11723L5.10203 7.42973L4.22703 8.94527ZM3.375 12.125H0.75V13.875H3.375V12.125ZM23.1713 19.8828L20.898 18.5703L21.773 17.0547L24.0463 18.3672L23.1713 19.8828Z"
                                  fill="url(#paint0_linear_101_298)"
                                />
                                <path
                                  fillRule="evenodd"
                                  clipRule="evenodd"
                                  d="M9.06251 23.4998C9.08685 23.4998 9.11114 23.4996 9.13539 23.4993H15.5665C15.5777 23.4995 15.5889 23.4997 15.6002 23.4998H15.625V23.4999C15.625 23.4999 15.625 23.4999 15.625 23.4999C17.0748 23.4999 18.25 22.3246 18.25 20.8749C18.25 19.4251 17.0748 18.2499 15.625 18.2499C14.9518 18.2499 14.3378 18.5033 13.8731 18.92C13.8768 18.8429 13.8787 18.7654 13.8787 18.6875C13.8787 18.0966 13.7722 17.5306 13.5774 17.0077C14.1883 16.6835 14.8852 16.4999 15.625 16.4999C18.0413 16.4999 20 18.4586 20 20.8749C20 23.2911 18.0413 25.2499 15.625 25.2499C15.6143 25.2499 15.6036 25.2499 15.5929 25.2498L9.09641 25.2498V25.2497C9.08511 25.2498 9.07381 25.2498 9.06251 25.2498C5.43814 25.2498 2.5 22.3117 2.5 18.6873C2.5 15.0629 5.43814 12.1248 9.06251 12.1248C11.9256 12.1248 14.3604 13.9582 15.257 16.5151C14.6529 16.5654 14.0837 16.7384 13.5744 17.0092C12.8933 15.1788 11.1302 13.8748 9.06251 13.8748C6.40463 13.8748 4.25 16.0294 4.25 18.6873C4.25 21.3452 6.40463 23.4998 9.06251 23.4998Z"
                                  fill="url(#paint1_linear_101_298)"
                                />
                                <defs>
                                  <linearGradient
                                    id="paint0_linear_101_298"
                                    x1="13"
                                    y1="0.75"
                                    x2="13"
                                    y2="19.8828"
                                    gradientUnits="userSpaceOnUse"
                                  >
                                    <stop stopColor="#EFC977" />
                                    <stop offset="1" stopColor="#E07256" />
                                  </linearGradient>
                                  <linearGradient
                                    id="paint1_linear_101_298"
                                    x1="11.25"
                                    y1="12.1248"
                                    x2="11.25"
                                    y2="25.2499"
                                    gradientUnits="userSpaceOnUse"
                                  >
                                    <stop stopColor="#B2D4F7" />
                                    <stop offset="1" stopColor="#D9E2F3" />
                                  </linearGradient>
                                </defs>
                              </svg>
                            }
                          />
                          <Text fontSize="sm" fontWeight="semi-bold">
                            15°
                          </Text>
                        </Flexbox>
                      </Card>
                      <Card>
                        <Flexbox
                          gap="xs"
                          alignItems="center"
                          justifyContent="center"
                        >
                          <Text fontSize="xs" secondary>
                            14:00
                          </Text>
                          <Icon
                            svg={
                              <svg
                                width="26"
                                height="25"
                                viewBox="0 0 26 25"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path
                                  fillRule="evenodd"
                                  clipRule="evenodd"
                                  d="M14.0219 13.3896L15.478 14.3604L12.8849 18.25H17.3362L12.5426 24.8873L11.1239 23.8627L13.9137 20H9.61499L14.0219 13.3896Z"
                                  fill="url(#paint0_linear_101_318)"
                                />
                                <path
                                  fillRule="evenodd"
                                  clipRule="evenodd"
                                  d="M7.75 19.7069C3.72708 18.6523 0.75 14.8742 0.75 10.375C0.75 5.05926 4.9058 0.75 10.0323 0.75C14.2853 0.75 17.8703 3.71604 18.9684 7.76213C19.0923 7.75409 19.2173 7.75001 19.3431 7.75001C22.6054 7.75001 25.25 10.4923 25.25 13.875C25.25 17.2577 22.6054 20 19.3431 20C19.2701 20 19.1974 19.9986 19.125 19.9959V18.25H19.3901V18.2497C21.6064 18.2233 23.5 16.3342 23.5 13.875C23.5 11.3984 21.5796 9.50001 19.3431 9.50001C18.7113 9.50001 18.1047 9.65152 17.5595 9.92479C17.5317 9.41571 17.457 8.91964 17.3399 8.44118L17.3373 8.44225C16.508 4.99379 13.5109 2.5 10.0323 2.5C5.93157 2.5 2.5 5.96541 2.5 10.375C2.5 13.9325 4.73353 16.8755 7.75 17.88V19.7069Z"
                                  fill="url(#paint1_linear_101_318)"
                                />
                                <defs>
                                  <linearGradient
                                    id="paint0_linear_101_318"
                                    x1="13.4756"
                                    y1="13.3896"
                                    x2="13.4756"
                                    y2="24.8873"
                                    gradientUnits="userSpaceOnUse"
                                  >
                                    <stop stopColor="#F5BD52" />
                                    <stop offset="1" stopColor="#F5DA79" />
                                  </linearGradient>
                                  <linearGradient
                                    id="paint1_linear_101_318"
                                    x1="13"
                                    y1="0.75"
                                    x2="13"
                                    y2="20"
                                    gradientUnits="userSpaceOnUse"
                                  >
                                    <stop stopColor="#95B6F6" />
                                    <stop offset="1" stopColor="#5193DE" />
                                  </linearGradient>
                                </defs>
                              </svg>
                            }
                          />
                          <Text fontSize="sm" fontWeight="semi-bold">
                            15°
                          </Text>
                        </Flexbox>
                      </Card>
                    </Flexbox>
                  </ScrollContainer>
                </TabContent>
                <TabContent value="tomorrow">
                  <Text>Tab 2 content</Text>
                </TabContent>
                <TabContent value="next">
                  <Text>Tab 3 content</Text>
                </TabContent>
              </TabGroup>
            </Flexbox>
          </WidgetWrapper>
          <WidgetWrapper noPadding paddingBottom>
            <Flexbox gap="lg" alignItems="center">
              <Image
                gradient
                gradientPosition="bottom"
                width="100%"
                height={282}
                src="/mockingbird.jpg"
              />
              <Flexbox alignItems="center">
                <Text fontSize="lg" fontWeight="semi-bold">
                  Mockingbird
                </Text>
                <Text secondary>Eminem</Text>
              </Flexbox>
              <Flexbox fullWidth paddingX gap="sm">
                <RangeSlider
                  width="100%"
                  defaultValue={33}
                  name="duration"
                  hiddenThumb
                />
                <Flexbox flexDirection="row" justifyContent="space-between">
                  <Text fontSize="xs" secondary>
                    1:44
                  </Text>
                  <Text fontSize="xs" secondary>
                    4:12
                  </Text>
                </Flexbox>
              </Flexbox>
              <Flexbox
                justifyContent="space-between"
                alignItems="center"
                flexDirection="row"
                fullWidth
                paddingX
              >
                <IconButton
                  iconName="shuffle"
                  light
                  activated
                  onClick={(data) => console.log('Shuffle', data.isActivated)}
                />
                <Flexbox flexDirection="row">
                  <IconButton
                    iconName="skip-left"
                    size="lg"
                    light
                    iconType="fill"
                  />
                  <IconButton
                    iconName={isPlayButton2Activated ? 'pause' : 'play'}
                    size="lg"
                    shape="circle"
                    iconType="fill"
                    activated={false}
                    onClick={(data) => {
                      console.log('Play', data.isActivated)
                      setIsPlayButton2Activated(data.isActivated)
                    }}
                  />
                  <IconButton
                    iconName="skip-right"
                    size="lg"
                    light
                    iconType="fill"
                  />
                </Flexbox>
                <IconButton
                  iconName="repeat"
                  light
                  activated={false}
                  onClick={(data) => console.log('Repeat', data.isActivated)}
                />
              </Flexbox>
            </Flexbox>
          </WidgetWrapper>
        </Flexbox>
      </Section>
    </>
  )
}
