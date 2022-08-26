// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { ERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";

/**
 * @title   rAura
 */
contract rAura is ERC20, Ownable {
    address public operator;

    /* ========== EVENTS ========== */

    event OperatorChanged(address indexed previousOperator, address indexed newOperator);

    /**
     * @param _nameArg      Token name
     * @param _symbolArg    Token symbol
     */
    constructor(string memory _nameArg, string memory _symbolArg) ERC20(_nameArg, _symbolArg) {}

    /**
     * @dev Mints AURA to a given user based on the BAL supply schedule.
     */
    function mint(address _to, uint256 _amount) external onlyOwner {
        _mint(_to, _amount);
    }

    function burn(address _from, uint256 _amount) external onlyOwner {
        _burn(_from, _amount);
    }
}
