// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Clones } from "@openzeppelin/contracts-0.8/proxy/Clones.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";

interface IInit {
    function init(address _vesting, address _owner) external;
}

/**
 * @title   VestingRecipientFactory
 * @author  AuraFinance
 */
contract VestingRecipientFactory is Ownable {
    // ----------------------------------------------------------
    // Storage
    // ----------------------------------------------------------

    /**
     * @dev The address of implementation
     */
    address public implementation;

    // ----------------------------------------------------------
    // Events
    // ----------------------------------------------------------

    event Created(address vestingRecipient, address vestedEscrow, address owner);

    event SetImplementation(address implementation);

    // ----------------------------------------------------------
    // Constructor
    // ----------------------------------------------------------

    /**
     * @param _implementation The address of implementation
     */
    constructor(address _implementation) {
        implementation = _implementation;
    }

    // ----------------------------------------------------------
    // Core
    // ----------------------------------------------------------

    /**
     * @dev Set address of vestingRecipient implementation
     * @param _implementation Address of implementation
     */
    function setImplementation(address _implementation) external onlyOwner {
        implementation = _implementation;
        emit SetImplementation(_implementation);
    }

    /**
     * @dev Create vestingRecipient instance
     * @param _vestedEscrow VestedEscrow V2 contract
     * @param _owner The owner of the vestingRecipient
     */
    function create(address _vestedEscrow, address _owner) external {
        address vestingRecipient = Clones.clone(implementation);
        IInit(vestingRecipient).init(_vestedEscrow, _owner);
        emit Created(vestingRecipient, _vestedEscrow, _owner);
    }
}
