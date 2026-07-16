# Tokenizer Ownership

`src.tokenizer` is an internal utility module. `remove_suffix` is not an exported
or supported public API, has no runtime consumer outside its owning component, and
may be changed locally without a cross-component contract migration.
