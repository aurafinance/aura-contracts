// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { PausableOFT } from "./PausableOFT.sol";

/**
 * @title AuraBalOFT
 * @author AuraFinance
 * @dev Sidechain auraBAL
 */
contract AuraBalOFT is PausableOFT {
    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        address _guardian
    ) PausableOFT(_name, _symbol, _lzEndpoint, _guardian) {}
}
