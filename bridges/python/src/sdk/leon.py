class Leon:
	instance: 'Leon' = None

	def __init__(self) -> None:
		if not Leon.instance:
			Leon.instance = self

leon = Leon()
