# Model strategy

This is a selection guideline, not an automatic runtime feature.

In the current release, the user selects the model. Nocturne does not route a
task to Sun, Earth or Moon automatically, and it does not yet let the user set
the effective reasoning effort for a run.

## Roles

| Role | Recommended work | Suggested effort |
| --- | --- | --- |
| **Sun** | Architecture, security and critical decisions | High to Max |
| **Earth** | Daily development, debugging and review | Medium |
| **Moon** | Documentation, maintenance and automation | Low to Medium |

The effort is a recommendation only. The effective value may be the model or
Provider default, and the available values can differ by Provider. Do not infer
that Sun means Max.

## Planned control

A future model-selection flow should show these values separately:

- strategy: Sun, Earth or Moon;
- model: the selected model;
- reasoning effort: Auto, Low, Medium, High, Extra High or Max when supported;
- effective effort: the value actually applied, or “Provider default” when it
  cannot be reported.

The implementation must not claim control for a Provider that does not expose
reasoning effort. Any automatic recommendation must remain visible and
overridable by the user.
