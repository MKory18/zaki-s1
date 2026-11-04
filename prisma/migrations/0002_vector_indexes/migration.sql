-- فهارس التشابه (HNSW بالمسافة الجيبية) لتضمينات النص والصورة.
CREATE INDEX "Candidate_textEmbedding_hnsw" ON "Candidate" USING hnsw ("textEmbedding" vector_cosine_ops);
CREATE INDEX "ImageAsset_imageEmbedding_hnsw" ON "ImageAsset" USING hnsw ("imageEmbedding" vector_cosine_ops);
