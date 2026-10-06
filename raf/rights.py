"""Explicit operation grants recorded by a trusted administrator, not legal verification."""


def require_grants(manifest, *operations):
    rights = manifest.get("rights", {})
    evidence = rights.get("evidence")
    grants = rights.get("operations", {})
    if (not isinstance(evidence, str) or not evidence.strip()
            or not isinstance(grants, dict)
            or any(grants.get(operation) is not True for operation in operations)):
        raise ValueError("Documented rights required for: " + ", ".join(operations))


def require_public_display(manifest):
    if manifest.get("research_only"):
        raise ValueError("Private research releases cannot be published")
    # The current renderer returns complete reviewed units, including footnotes.
    # A permission for short excerpts alone cannot authorize this rendering mode.
    require_grants(manifest, "index", "display_full_units")
    if manifest["rights"].get("publish_allowed") is not True:
        raise ValueError("Publication rights are not documented")
