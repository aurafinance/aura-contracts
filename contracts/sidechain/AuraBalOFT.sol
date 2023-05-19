// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { PausableOFT } from "./PausableOFT.sol";

/**
 * @title AuraBalOFT
 * @author AuraFinance
 * @dev Sidechain auraBAL
 */
contract AuraBalOFT is PausableOFT {
    /**
     * @dev Constructs the AuraBalOFT contract.
     * @param _name       The oft token name
     * @param _symbol     The oft token symbol
     * @param _lzEndpoint LayerZero endpoint contract
     * @param _guardian   The pause guardian address
     */
    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        address _guardian
    ) PausableOFT(_name, _symbol, _lzEndpoint, _guardian) {}
}
