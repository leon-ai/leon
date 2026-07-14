import { useEffect, useState, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import {
  WidgetWrapper,
  Text,
  Icon,
  Flexbox,
  List,
  ListHeader,
  ListItem,
  Loader
} from '@aurora'

const container = document.querySelector('#init')
const root = createRoot(container)
const LLAMA_SERVER_BOOT_STATUS = 'llamaServerBoot'
const INIT_ERROR_STATUS = 'error'
const INIT_ERROR_DISMISS_SECONDS = 10
const INIT_ERROR_DISMISS_INTERVAL_MS = 1_000

function Item({ children, status }) {
  if (status === 'error') {
    return <ErrorListItem>{children}</ErrorListItem>
  }
  if (status === 'warning') {
    return <WarningListItem>{children}</WarningListItem>
  }
  if (status === 'success') {
    return <SuccessListItem>{children}</SuccessListItem>
  }
  if (status === 'loading') {
    return <LoadingListItem>{children}</LoadingListItem>
  }

  return <ListItem>{children}</ListItem>
}

function LoadingListItem({ children }) {
  return (
    <ListItem>
      <Flexbox flexDirection="row" alignItems="center" gap="sm">
        <Loader size="sm" />
        <Text>{children}</Text>
      </Flexbox>
    </ListItem>
  )
}
function ErrorListItem({ children }) {
  return (
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
        <Text>{children}</Text>
      </Flexbox>
    </ListItem>
  )
}
function WarningListItem({ children }) {
  return (
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
        <Text>{children}</Text>
      </Flexbox>
    </ListItem>
  )
}
function SuccessListItem({ children }) {
  return (
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
        <Text>{children}</Text>
      </Flexbox>
    </ListItem>
  )
}

function Init() {
  const parentRef = useRef(null)
  const [config, setConfig] = useState(() => ({ ...window.leonConfigInfo }))
  const usesLlamaCPP =
    config.llm?.workflowProvider === 'llamacpp' ||
    config.llm?.agentProvider === 'llamacpp'
  const [initErrorCountdown, setInitErrorCountdown] = useState(null)
  const [areInitErrorsDismissed, setAreInitErrorsDismissed] = useState(false)
  const [statusMap, setStatusMap] = useState({
    clientCoreServerHandshake: 'loading',
    tcpServerBoot:
      window.leonConfigInfo?.tcpServer?.enabled === false ? 'success' : 'loading',
    [LLAMA_SERVER_BOOT_STATUS]:
      window.leonConfigInfo?.llm?.workflowProvider === 'llamacpp' ||
      window.leonConfigInfo?.llm?.agentProvider === 'llamacpp'
        ? 'loading'
        : 'success'
  })
  const hasInitError = Object.values(statusMap).some(
    (status) => status === INIT_ERROR_STATUS
  )

  useEffect(() => {
    setTimeout(() => {
      if (parentRef.current) {
        parentRef.current.classList.remove('not-initialized')
      }
    }, 250)

    function handleStatusChange(event) {
      const { statusName, statusType } = event.detail

      if (statusType === INIT_ERROR_STATUS) {
        setAreInitErrorsDismissed(false)
      }

      setStatusMap((prev) => ({ ...prev, [statusName]: statusType }))
    }

    window.leonInitStatusEvent.addEventListener(
      'initStatusChange',
      handleStatusChange
    )
    return () =>
      window.leonInitStatusEvent.removeEventListener(
        'initStatusChange',
        handleStatusChange
      )
  }, [])

  useEffect(() => {
    if (!hasInitError || areInitErrorsDismissed) {
      setInitErrorCountdown(null)
      return
    }

    let secondsLeft = INIT_ERROR_DISMISS_SECONDS
    setInitErrorCountdown(secondsLeft)

    const interval = setInterval(() => {
      secondsLeft -= 1
      setInitErrorCountdown(secondsLeft)

      if (secondsLeft <= 0) {
        clearInterval(interval)
        setAreInitErrorsDismissed(true)
      }
    }, INIT_ERROR_DISMISS_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [hasInitError, areInitErrorsDismissed])

  const statuses = []
  for (let key of Object.keys(statusMap)) {
    if (key === 'tcpServerBoot' && config.tcpServer?.enabled === false) {
      statuses.push('success')
    } else if (statusMap[key] === INIT_ERROR_STATUS && areInitErrorsDismissed) {
      statuses.push('success')
    } else if (
      key === LLAMA_SERVER_BOOT_STATUS &&
      !usesLlamaCPP
    ) {
      statuses.push('success')
    } else {
      statuses.push(statusMap[key])
    }
  }

  const areAllStatusesSuccess = statuses.every((status) => status === 'success')
  const getInitMessage = (status, defaultMessage) => {
    if (status === INIT_ERROR_STATUS && initErrorCountdown !== null) {
      return `An error occurred during the initialization. This message will disappear in ${initErrorCountdown} seconds`
    }

    return defaultMessage
  }

  useEffect(() => {
    if (window.leonConfigInfo) {
      setConfig({ ...window.leonConfigInfo })
    }
  }, [window.leonConfigInfo])

  return (
    <div
      style={{
        position: 'fixed',
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
        backgroundColor: 'var(--black-color)'
      }}
      ref={parentRef}
      className={areAllStatusesSuccess ? 'initialized' : 'not-initialized'}
    >
      <div
        style={{
          position: 'absolute',
          top: '33%',
          left: '50%',
          transform: 'translate(-50%, -50%)'
        }}
      >
        <WidgetWrapper noPadding>
          <List>
            <ListHeader>Leon is getting ready...</ListHeader>
            <Item status={statusMap.clientCoreServerHandshake}>
              {getInitMessage(
                statusMap.clientCoreServerHandshake,
                'Client and core server handshaked'
              )}
            </Item>
            {config.tcpServer?.enabled !== false && (
              <Item status={statusMap.tcpServerBoot}>
                {getInitMessage(statusMap.tcpServerBoot, 'TCP server booted')}
              </Item>
            )}
            {usesLlamaCPP && (
              <Item status={statusMap[LLAMA_SERVER_BOOT_STATUS]}>
                {getInitMessage(
                  statusMap[LLAMA_SERVER_BOOT_STATUS],
                  'llama-server booted'
                )}
              </Item>
            )}
          </List>
        </WidgetWrapper>
      </div>
    </div>
  )
}

root.render(<Init />)
