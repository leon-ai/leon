class Leon:
	instance: 'Leon' = None

	def __init__(self) -> None:
		if not Leon.instance:
			Leon.instance = self

	def get_src_config(key: str = None) -> T:
        try:
            if key:
                return SKILL_SRC_CONFIG[key]

            return SKILL_SRC_CONFIG
        except Exception as e:
            print('Error while getting source configuration:', e)
            return {}

leon = Leon()
