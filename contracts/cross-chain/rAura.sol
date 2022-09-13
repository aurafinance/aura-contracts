// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { ERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";

/**
 * @title rAura
 */
contract rAura is ERC20, Ownable {
    constructor(string memory _nameArg, string memory _symbolArg) ERC20(_nameArg, _symbolArg) {}

    function mint(address _to, uint256 _amount) external onlyOwner {
        _mint(_to, _amount);
    }

    function burn(address _from, uint256 _amount) external onlyOwner {
        // TODO: check approval
        _burn(_from, _amount);
    }
}
