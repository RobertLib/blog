class CommentsController < ApplicationController
  allow_unauthenticated_access only: %i[ create ]

  def create
    @post = Post.find(params[:post_id])
    @comment = @post.comments.create(comment_params)

    respond_to do |format|
      format.html { redirect_to post_path(@post) }
      format.turbo_stream
    end
  end

  private

  def comment_params
    params.expect(comment: [ :commenter, :body, :status ])
  end
end
