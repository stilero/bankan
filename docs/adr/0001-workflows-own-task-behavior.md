# Workflows own task behavior

New tasks take all agent behavior and execution policy from an immutable published Workflow Version rather than combining workflow structure with global stage settings. Application Settings retain installation-wide resources and capacity, while legacy behavior remains available only through a compatibility path for existing tasks. This prevents two competing configuration sources and makes a task's behavior explainable and reproducible, at the cost of a versioned schema migration and temporary legacy support.
