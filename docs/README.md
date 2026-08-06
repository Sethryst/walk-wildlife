# Documentation index

This folder is the short handoff package for people or AI agents changing the project without first reading every source file.

1. Read [Architecture.md](Architecture.md) for the system boundary and current-vs-adjacent subsystems.
2. Read [CodebaseMap.md](CodebaseMap.md) to find the likely ownership files.
3. Read [DataFlow.md](DataFlow.md) for the path a feature’s data takes.
4. Use [FileIndex.md](FileIndex.md) as a dependency-aware lookup table.
5. Follow [DeveloperGuide.md](DeveloperGuide.md) for local running, safe change recipes, and an outside-AI prompt.
6. Check [archive.md](archive.md) before deleting or moving files.
7. For developer-only offline package work, read [RegionBuildAudit.md](RegionBuildAudit.md) and [RegionBuildPipeline.md](RegionBuildPipeline.md).
8. See [RegionBuildDependencies.md](RegionBuildDependencies.md) and [RegionImportContract.md](RegionImportContract.md) before running or integrating with the builder.
9. [RegionBuildStages.md](RegionBuildStages.md) specifies the input, output, and failure behavior of every build stage.

`automation.md` was pre-existing and is retained as background/reference material. Its length makes it unsuitable as the first read; keep this index and the focused documents current when implementation changes.

## One-sentence project model

The active application is a static ES-module walking journal whose city POI JSON is seeded into browser IndexedDB; optional Supabase and region packages are separate, opt-in/adjacent systems.
