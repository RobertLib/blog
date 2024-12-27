class Post < ApplicationRecord
  include Visible

  has_many :comments, dependent: :destroy
  has_rich_text :content

  validates :title, :content, presence: true
end
