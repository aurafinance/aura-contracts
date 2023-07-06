// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
import "@openzeppelin/contracts-0.8/access/Ownable.sol";

/**
 *  @title KeeperRole
 *  @notice Keeper role to allow an address to call functions.
 *  @author Aura Finance
 */
contract KeeperRole is Ownable {
    mapping(address => bool) public authorizedKeepers;

    constructor(address _owner) {
        _transferOwnership(_owner);
    }

    /// @notice Adds or remove an address from the keeper's whitelist
    /// @param _keeper address of the authorized keeper
    /// @param _authorized Whether to add or remove keeper
    function updateAuthorizedKeepers(address _keeper, bool _authorized) external onlyOwner {
        authorizedKeepers[_keeper] = _authorized;
    }

    /* -------------------------------------------------------------------
       Modifiers 
    ------------------------------------------------------------------- */

    modifier onlyKeeper() {
        require(authorizedKeepers[msg.sender], "!keeper");
        _;
    }
}
