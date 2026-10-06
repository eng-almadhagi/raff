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


def require_publication_decision(manifest, source_id):
    """Accept an explicit operator decision without representing it as a license.

    A documented prohibition is never overridden by this deployment mode.
    Scientific approval remains separate and may be pending in a public preview.
    """
    decision = manifest.get("operator_publication_decision", {})
    if decision:
        if (manifest.get("explicit_prohibition") is not False
                or decision.get("publish_current_content") is not True
                or decision.get("license_status") != "unresolved"
                or source_id not in decision.get("sources", [])
                or not decision.get("recorded_at")
                or not decision.get("instruction")):
            raise ValueError("Incomplete operator publication decision or explicit prohibition")
        return "operator-directed-preview"
    require_public_display(manifest)
    if manifest.get("scientific_review", {}).get("approved") is not True:
        raise ValueError("Source release review is not recorded")
    return "licensed-reviewed"
