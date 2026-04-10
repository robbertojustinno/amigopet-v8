from pydantic import BaseModel, Field
from typing import Optional

class PetCreate(BaseModel):
    owner_id: int
    name: str = Field(min_length=1, max_length=80)
    breed: Optional[str] = None
    size: Optional[str] = None
    notes: Optional[str] = None

class PetOut(BaseModel):
    id: int
    owner_id: int
    name: str
    breed: Optional[str] = None
    size: Optional[str] = None
    notes: Optional[str] = None

    class Config:
        from_attributes = True
