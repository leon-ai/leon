import {
  Flexbox,
  Icon,
  Link,
  List,
  ListHeader,
  ListItem,
  Text
} from '@aurora'

function InlineLabel({ item }) {
  if (item.inline_link_label && item.inline_link_href) {
    return (
      <Text>
        {item.label}{' '}
        <Link href={item.inline_link_href} fontSize="md">
          {item.inline_link_label}
        </Link>.
      </Text>
    )
  }

  return <Text>{item.label}</Text>
}

function ToneListItem({ item }) {
  if (item.tone === 'success') {
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
          <InlineLabel item={item} />
        </Flexbox>
      </ListItem>
    )
  }

  if (item.tone === 'warning') {
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
          <InlineLabel item={item} />
        </Flexbox>
      </ListItem>
    )
  }

  if (item.tone === 'error') {
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
          <InlineLabel item={item} />
        </Flexbox>
      </ListItem>
    )
  }

  if (item.value || item.description) {
    return (
      <ListItem>
        <div className="built-in-commands-modal__result-item">
          <div className="built-in-commands-modal__result-copy">
            <Text fontWeight="semi-bold">{item.label}</Text>
            {item.description ? <Text secondary>{item.description}</Text> : null}
          </div>
          {item.value ? (
            <div className="built-in-commands-modal__result-value">
              {item.href ? (
                <Link href={item.href} fontSize="md">
                  {item.value}
                </Link>
              ) : (
                <Text secondary textAlign="right">
                  {item.value}
                </Text>
              )}
            </div>
          ) : null}
        </div>
      </ListItem>
    )
  }

  if (item.inline_link_label && item.inline_link_href) {
    return (
      <ListItem>
        <InlineLabel item={item} />
      </ListItem>
    )
  }

  return (
    <ListItem>
      <InlineLabel item={item} />
    </ListItem>
  )
}

export function BuiltInCommandResultRenderer({ result }) {
  const blocks = Array.isArray(result?.blocks) ? result.blocks : []

  return (
    <Flexbox flexDirection="column" gap="sm">
      {blocks.map((block, index) => {
        if (block.type !== 'list') {
          return null
        }

        const header = block.header || (index === 0 ? result.title : '')

        return (
          <List key={`result-block-${index}`}>
            {header ? <ListHeader>{header}</ListHeader> : null}
            {block.items.map((item, itemIndex) => (
              <ToneListItem item={item} key={`result-item-${itemIndex}`} />
            ))}
          </List>
        )
      })}
    </Flexbox>
  )
}
