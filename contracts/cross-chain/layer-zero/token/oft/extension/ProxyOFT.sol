// SPDX-License-Identifier: MIT

pragma solidity ^0.8.2;

import "../OFTCore.sol";
import "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";

contract ProxyOFT is OFTCore {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    constructor(address _lzEndpoint, address _proxyToken) OFTCore(_lzEndpoint) {
        token = IERC20(_proxyToken);
    }

    function circulatingSupply() public view virtual override returns (uint256) {
        unchecked {
            return token.totalSupply() - token.balanceOf(address(this));
        }
    }

    function _debitFrom(
        address _from,
        uint16,
        bytes memory,
        uint256 _amount
    ) internal virtual override {
        require(_from == _msgSender(), "ProxyOFT: owner is not send caller");
        token.safeTransferFrom(_from, address(this), _amount);
    }

    function _creditTo(
        uint16,
        address _toAddress,
        uint256 _amount
    ) internal virtual override {
        token.safeTransfer(_toAddress, _amount);
    }
}
