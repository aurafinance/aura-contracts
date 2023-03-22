const { findAll } = require("solidity-ast/utils");

module.exports = {
    eq: (a, b) => a === b,

    /** @this {import('solidity-docgen').DocItemWithContext} */
    allEvents() {
        if (this.nodeType === "ContractDefinition") {
            const { deref } = this.__item_context.build;
            const parents = this.linearizedBaseContracts.map(deref("ContractDefinition"));
            return parents.flatMap(p => [...findAll("EventDefinition", p)]);
        }
    },
};
