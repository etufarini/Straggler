# R008/R009 review evidence

These are actual renderer captures from isolated development fixtures, with simulated services and no inference. Before captures use a25e326; after captures use the R008/R009 implementation. The development notice is part of every capture. No personal configuration or model weights are used.

| View | Before | After |
| --- | --- | --- |
| Model settings, 1200×820 | [Before](model-before.png) | [After](model-after.png) |
| Storage feedback, 1200×820 | [Before](feedback-before.png) | [After](feedback-after.png) |
| Overview, 1200×820 | — | [After](overview-after.png) |
| Compact model settings, 760×560 | — | [After](model-compact-after.png) |
| Memory feedback in its chat column, 1200×820 | — | [After](memory-feedback-after.png) |

[Before measurements](before.json) and [after measurements](after.json) cover the same seven scenarios at 1200×820, 1440×900 and 760×560. The local review run also captures all eight Settings destinations, first setup, memory failure, system prompt, message errors, model selection and configuration confirmation at those sizes. Run the [advisory audit](../../scripts/README.md) to reproduce it.

The reports retain all advisory findings, including compound action rows, section separators and panel headings that are not consecutive fields. Text action insets fall from 28 to zero; horizontal sibling findings from nine to zero. Representative consecutive model/performance fields measure 26–29 px after the change. A warning is a review cue, not a failed assertion.

This small evidence set accompanies the implementation. It does not regenerate the frozen design dossier or include the local proposal materials.
