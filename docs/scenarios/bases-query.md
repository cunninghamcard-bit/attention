# Scenario: Bases Query

```text
Markdown frontmatter
  -> MetadataCache.frontmatter
  -> PropertyStore.getFileProperties(path)
  -> QueryEngine.run(filters/sort)
  -> buildBasesQueryResult
  -> BasesView renders table
```
