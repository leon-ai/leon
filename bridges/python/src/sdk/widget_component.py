from typing import TypeVar, Generic, TypedDict

T = TypeVar('T', TypedDict, dict)


class WidgetComponent(Generic[T]):
    def __init__(self, props: T):
        self.component = type(self).__name__
        self.props = props

    def __dict__(self):
        children_value = self.props.get('children')
        rest_of_values = {key: value for key, value in self.props.items() if key != 'children'}
        children = None
        if children_value is not None:
            if isinstance(children_value, list):
                children = []
                for child in children_value:
                    if isinstance(child, WidgetComponent):
                        children.append(child.__dict__())
                    else:
                        children.append(child)
            else:
                children = children_value
        result = {
            'component': self.component,
            'props': {
                **rest_of_values,
                'children': children
            }
        }
        return result
