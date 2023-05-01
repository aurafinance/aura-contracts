// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
import "@openzeppelin/contracts-0.8/token/ERC20/ERC20.sol";
import { IERC677 } from "../../interfaces/IERC677.sol";

contract MockERC677 is ERC20, IERC677 {
    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        address _initialRecipient,
        uint256 _initialMint
    ) ERC20(_name, _symbol) {
        if (_initialMint >= type(uint256).max) {
            _mint(_initialRecipient, type(uint256).max);
        } else {
            _mint(_initialRecipient, _initialMint * (10**uint256(_decimals)));
        }
    }

    function mint(uint256 amount) public {
        _mint(msg.sender, amount);
    }

    function transferAndCall(
        address, /* _to */
        uint256 _amount,
        bytes calldata _data
    ) external returns (bool) {
        // for testing ignore the `to` and send directly to the address on data
        address receiver = bytesToAddress(_data);

        _transfer(_msgSender(), receiver, _amount);
        return true;
    }

    function bytesToAddress(bytes calldata b) private pure returns (address) {
        return address(uint160(bytes20(b)));
    }
}
