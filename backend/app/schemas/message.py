from pydantic import BaseModel, Field

class MessageCreate(BaseModel):
    walk_request_id: int
    sender_id: int
    text: str = Field(min_length=1, max_length=1000)

class MessageOut(BaseModel):
    id: int
    walk_request_id: int
    sender_id: int
    text: str
    created_at: str | None = None

    class Config:
        from_attributes = True
