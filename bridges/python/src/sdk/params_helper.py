from typing import Any, Dict, List, Optional

from constants import INTENT_OBJECT

NEREntity = Dict[str, Any]
ActionParams = Dict[str, Any]


class ParamsHelper:
    """
    A helper class to simplify accessing data from the action's params object
    """

    def __init__(self, params: ActionParams):
        self._params = params

    def get_widget_id(self) -> Optional[str]:
        """
        Get the widget ID if any
        """
        for entity in INTENT_OBJECT['entities']:
            if entity['entity'] == 'widgetid':
                return entity['sourceText']

        return None

    def get_action_argument(self, name: str) -> Optional[Any]:
        """
        Get a specific action argument from the current turn by its name

        :param name: The name of the action argument to retrieve
        """

        return self._params.get('action_arguments', {}).get(name)

    def find_entity(self, entity_name: str) -> Optional[NEREntity]:
        """
        Find the first entity in the current turn that matches the given name

        :param entity_name: The name of the entity to find (e.g., 'language')
        """

        entities = self._params.get('entities', [])

        # A generator expression with next() is an efficient way to find the first item
        return next((entity for entity in entities if entity.get('entity') == entity_name), None)

    def find_last_entity(self, entity_name: str) -> Optional[NEREntity]:
        """
        Find the last entity in the current turn that matches the given name.
        Useful when an utterance contains duplicates

        :param entity_name: The name of the entity to find (e.g., 'color')
        """

        entities = self._params.get('entities', [])

        # Iterate over a reversed list to find the last occurrence first
        return next((entity for entity in reversed(entities) if entity.get('entity') == entity_name), None)

    def find_all_entities(self, entity_name: str) -> List[NEREntity]:
        """
        Find all entities in the current turn that match the given name

        :param entity_name: The name of the entities to find (e.g., 'date')
        """

        entities = self._params.get('entities', [])

        return [entity for entity in entities if entity.get('entity') == entity_name]

    def find_action_argument_from_context(self, name: str) -> Optional[Any]:
        """
        Find the first action argument in the conversation context that matches the given name

        :param name: The name of the action argument to find
        """

        action_args_history = self._params.get('context', {}).get('action_arguments', [])
        for args in action_args_history:
            if args and name in args:
                return args[name]

        return None

    def find_last_action_argument_from_context(self, name: str) -> Optional[Any]:
        """
        Find the most recent value for a given action argument from the conversation context.
        It searches backwards from the most recent turn

        :param name: The name of the action argument to find
        """

        action_args_history = self._params.get('context', {}).get('action_arguments', [])
        for args in reversed(action_args_history):
            if args and name in args:
                return args[name]

        return None

    def find_last_entity_from_context(self, entity_name: str) -> Optional[NEREntity]:
        """
        Find the most recently detected entity (the last one from the context) that matches the given name.
        This is useful for recalling the last time a user mentioned a specific piece of information

        :param entity_name: The name of the entity to find in the conversation history
        """

        context_entities = self._params.get('context', {}).get('entities', [])

        return next((entity for entity in reversed(context_entities) if entity.get('entity') == entity_name), None)

    def find_all_entities_from_context(self, entity_name: str) -> List[NEREntity]:
        """
        Find all historical entities that match the given name from the entire conversation context

        :param entity_name: The name of the entities to find in the conversation history
        """

        context_entities = self._params.get('context', {}).get('entities', [])

        return [entity for entity in context_entities if entity.get('entity') == entity_name]

    def get_context_data(self, key: str) -> Optional[Any]:
        """
        Get a value stored in the generic context data store

        :param key: The key to retrieve
        """

        return self._params.get('context', {}).get('data', {}).get(key)
