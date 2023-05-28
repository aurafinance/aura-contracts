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
     */
    constructor(string memory _name, string memory _symbol) PausableOFT(_name, _symbol) {}

    /**
     * Initialize the contract.
     * @param _lzEndpoint LayerZero endpoint contract
     * @param _guardian   Pause guardian
     */
    function initialize(address _lzEndpoint, address _guardian) external onlyOwner {
        _initializeLzApp(_lzEndpoint);
        _initializePauseGuardian(_guardian);
    }
}
