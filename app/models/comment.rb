class Comment < ApplicationRecord
  include Visible

  belongs_to :post
end
