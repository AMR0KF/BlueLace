from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


def _check_color_images(value: Optional[dict[str, str]]) -> Optional[dict[str, str]]:
    if value is None:
        return None
    if len(value) > 40:
        raise ValueError("Too many color images (max 40).")
    for color, image in value.items():
        if not color or len(color) > 40:
            raise ValueError("Color name must be 1-40 characters.")
        if len(image) > 200_000:
            raise ValueError(f"Image for '{color}' is too large — use a smaller photo.")
    return value


class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=60)
    pin: str = Field(min_length=4, max_length=12)


class UserCreateBody(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    role: Literal["admin", "manager", "cashier"]
    pin: str = Field(min_length=4, max_length=12, pattern=r"^\d+$")


class UserPatchBody(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    role: Optional[Literal["admin", "manager", "cashier"]] = None
    active: Optional[bool] = None
    pin: Optional[str] = Field(default=None, min_length=4, max_length=12, pattern=r"^\d+$")


class ModelBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    brand: Optional[str] = Field(default=None, max_length=80)
    category: Optional[str] = Field(default=None, max_length=80)
    image: Optional[str] = Field(default=None, max_length=200_000)
    colorImages: Optional[dict[str, str]] = None
    tileColor: Optional[str] = Field(default=None, max_length=30)
    basePrice: float = Field(ge=0)
    defaultCost: float = Field(default=0, ge=0)
    sortOrder: int = 0

    _color_images = field_validator("colorImages")(_check_color_images)


class ModelPatchBody(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    brand: Optional[str] = Field(default=None, max_length=80)
    category: Optional[str] = Field(default=None, max_length=80)
    image: Optional[str] = Field(default=None, max_length=200_000)
    colorImages: Optional[dict[str, str]] = None
    tileColor: Optional[str] = Field(default=None, max_length=30)
    basePrice: Optional[float] = Field(default=None, ge=0)
    defaultCost: Optional[float] = Field(default=None, ge=0)
    sortOrder: Optional[int] = None
    active: Optional[bool] = None

    _color_images = field_validator("colorImages")(_check_color_images)


class VariantSpec(BaseModel):
    color: str = Field(min_length=1, max_length=40)
    size: str = Field(min_length=1, max_length=20)
    sku: Optional[str] = Field(default=None, max_length=60)
    barcode: Optional[str] = Field(default=None, max_length=60)
    priceOverride: Optional[float] = Field(default=None, ge=0)


class VariantMatrixBody(BaseModel):
    variants: list[VariantSpec] = Field(min_length=1, max_length=500)
    prune: bool = False


class VariantPatchBody(BaseModel):
    sku: Optional[str] = Field(default=None, max_length=60)
    barcode: Optional[str] = Field(default=None, max_length=60)
    priceOverride: Optional[float] = Field(default=None, ge=0)
    clearPriceOverride: bool = False
    active: Optional[bool] = None


class ReceiveStockBody(BaseModel):
    variantId: str
    qty: int = Field(ge=1, le=100_000)
    unitCost: float = Field(ge=0)
    note: Optional[str] = Field(default=None, max_length=200)


class AdjustStockBody(BaseModel):
    variantId: str
    qtyDelta: int = Field(ge=-100_000, le=100_000)
    reason: str = Field(min_length=1, max_length=200)


class ReviewResolveBody(BaseModel):
    note: Optional[str] = Field(default=None, max_length=200)


class SupplierBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=40)
    note: Optional[str] = Field(default=None, max_length=400)


class SupplierPatchBody(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=40)
    note: Optional[str] = Field(default=None, max_length=400)
    active: Optional[bool] = None


class PurchaseLineBody(BaseModel):
    variantId: str
    qty: int = Field(ge=1, le=100_000)
    unitCost: float = Field(ge=0)


class PurchaseBody(BaseModel):
    supplierId: Optional[str] = None
    invoiceNo: Optional[str] = Field(default=None, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=400)
    lines: list[PurchaseLineBody] = Field(min_length=1, max_length=300)
    paidFromDrawer: float = Field(default=0, ge=0)  # base currency, paid out now


class CustomerBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=40)
    note: Optional[str] = Field(default=None, max_length=400)
    creditLimit: float = Field(default=0, ge=0)


class SaleLineBody(BaseModel):
    variantId: Optional[str] = None
    customName: Optional[str] = Field(default=None, max_length=120)
    qty: int = Field(ge=1, le=10_000)
    unitPrice: float = Field(ge=0)


class SaleBody(BaseModel):
    id: Optional[str] = Field(default=None, max_length=60)          # offline replay
    createdAt: Optional[str] = Field(default=None, max_length=40)   # offline replay
    customerId: Optional[str] = None
    lines: list[SaleLineBody] = Field(min_length=1, max_length=200)
    discountAmount: float = Field(default=0, ge=0)
    discountReason: Optional[str] = Field(default=None, max_length=200)
    tenderCurrency: str = Field(max_length=10)
    tenderRate: Optional[float] = Field(default=None, gt=0)
    paymentMode: Literal["cash", "partial"]
    paidNow: float = Field(default=0, ge=0)                          # base currency, partial mode
    memo: Optional[str] = Field(default=None, max_length=400)


class SaleLinePricePatch(BaseModel):
    saleItemId: str
    unitPrice: float = Field(ge=0)


class SaleLinesPatchBody(BaseModel):
    lines: list[SaleLinePricePatch] = Field(min_length=1, max_length=200)


class SaleCustomerPatchBody(BaseModel):
    customerId: Optional[str] = None


class SaleDiscountPatchBody(BaseModel):
    discountAmount: float = Field(ge=0)
    discountReason: Optional[str] = Field(default=None, max_length=200)


class VoidBody(BaseModel):
    reason: str = Field(min_length=1, max_length=200)


class ReturnLineBody(BaseModel):
    saleItemId: str
    qty: int = Field(ge=1, le=10_000)


class ReturnBody(BaseModel):
    lines: list[ReturnLineBody] = Field(min_length=1, max_length=200)
    refundMethod: Literal["cash", "store_credit"]
    reason: Optional[str] = Field(default=None, max_length=200)


class CollectAllocation(BaseModel):
    saleId: str
    amount: float = Field(gt=0)


class CollectBody(BaseModel):
    customerId: str
    amount: float = Field(default=0, ge=0)                # cash portion, base currency
    tenderCurrency: str = Field(default="USD", max_length=10)
    tenderRate: Optional[float] = Field(default=None, gt=0)
    mode: Literal["auto", "per_order"] = "auto"
    allocations: Optional[list[CollectAllocation]] = None
    useStoreCredit: bool = False
    notes: Optional[str] = Field(default=None, max_length=200)


class CashMovementBody(BaseModel):
    movementType: Literal["paid_out", "cash_in"]
    amountBase: float = Field(gt=0)
    category: Optional[Literal[
        "owner_draw", "cash_drop", "supplier", "petty_cash", "refund", "other", "note"
    ]] = None
    notes: Optional[str] = Field(default=None, max_length=200)
    tenderCurrency: str = Field(default="USD", max_length=10)


class SettingsBody(BaseModel):
    # Partial update: only provided keys are written (PATCH semantics like the original).
    exchangeRate: Optional[float] = Field(default=None, gt=0)
    taxRate: Optional[float] = Field(default=None, ge=0, le=100)
    lbpDisplayRounding: Optional[Literal[1, 250, 500, 1000]] = None
    businessName: Optional[str] = Field(default=None, max_length=120)
    businessTagline: Optional[str] = Field(default=None, max_length=200)
    businessPhone: Optional[str] = Field(default=None, max_length=60)
    businessAddress: Optional[str] = Field(default=None, max_length=300)
    receiptFooter: Optional[str] = Field(default=None, max_length=400)
    logoUrl: Optional[str] = Field(default=None, max_length=200_000)
