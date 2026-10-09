// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

interface IWithdrawal {
    function withdraw(uint256 amount, address payable destination) external;
}
contract RejectReceiver {
    receive() external payable { revert("fixture rejects transfer"); }
}
contract ReentrantReceiver {
    IWithdrawal public immutable target;
    bool public attempted;
    bool public reentered;
    constructor(address contractAddress) { target = IWithdrawal(contractAddress); }
    function trigger() external { target.withdraw(3, payable(address(this))); }
    receive() external payable {
        if (!attempted) {
            attempted = true;
            (bool ok,) = address(target).call(abi.encodeCall(IWithdrawal.withdraw, (4, payable(address(this)))));
            reentered = ok;
        }
    }
}
